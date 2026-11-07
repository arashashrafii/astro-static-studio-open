package org.astross.studio;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/** Pages Direct Upload boundary. Credentials are supplied for this call and never retained or logged. */
final class CloudflarePagesDirectUploadClient {
    static final String API_BASE="https://api.cloudflare.com/client/v4";
    static final String PREVIEW_BRANCH="studio-preview";
    static final int MAX_BATCH_RAW_BYTES=512*1024,MAX_BATCH_FILES=2000,MAX_REQUEST_BYTES=12*1024*1024,MAX_RESPONSE_BYTES=1024*1024;
    interface Transport { Response execute(String method,String url,String bearer,String contentType,byte[] body)throws Exception; }
    static final class Response { final int status;final JSONObject json;Response(int status,JSONObject json){this.status=status;this.json=json==null?new JSONObject():json;} }
    static final class Deployment { final String id,url,branch,revision;Deployment(String id,String url,String branch,String revision){this.id=id;this.url=url;this.branch=branch;this.revision=revision;} }
    private static final class Multipart {final String boundary;final byte[] body;Multipart(String boundary,byte[] body){this.boundary=boundary;this.body=body;}}
    private static final class Asset {final String path,hash,contentType;final byte[] content;Asset(String path,String hash,String contentType,byte[] content){this.path=path;this.hash=hash;this.contentType=contentType;this.content=content;}}

    private final Transport transport;
    CloudflarePagesDirectUploadClient(Transport transport){this.transport=transport;}

    Deployment deployPreview(String accountId,String projectName,String apiToken,GithubArtifactArchive.VerifiedSite site)throws Exception{
        validateInputs(accountId,projectName,apiToken);
        if(site==null||site.sourceRevision==null||!site.sourceRevision.matches("[0-9a-f]{40}")||site.workflowRevision==null||!site.workflowRevision.matches("[0-9a-f]{40}"))throw new IllegalArgumentException("GitHub-verified source and workflow revisions are required.");
        CloudflareArtifactManifest manifest=CloudflareArtifactManifest.from(site);
        String sourceRevision=site.sourceRevision;
        if(!sourceRevision.equals(manifest.sourceRevision)||!site.workflowRevision.equals(manifest.workflowRevision))throw new SecurityException("The verified source or workflow revision does not match the build manifest.");
        Map<String,byte[]> files=site.files();validateOutputPaths(files);
        Map<String,Asset> uniqueAssets=assetsForUpload(manifest,files);
        if(manifest.assets.size()>20_000)throw new IllegalArgumentException("Cloudflare's deployment manifest entry limit was exceeded.");

        String projectPath=API_BASE+"/accounts/"+accountId+"/pages/projects/"+projectName;
        JSONObject projectPayload=success(request("GET",projectPath,apiToken,null,null),200,"Could not verify the selected Pages project.");
        JSONObject project=projectPayload.optJSONObject("result");
        if(project==null||!projectName.equals(project.optString("name",""))||project.optString("production_branch","").isEmpty()||PREVIEW_BRANCH.equals(project.optString("production_branch",""))||!allowsPreviewBranch(project))
            throw new SecurityException("The selected Pages project is not configured for this preview branch.");
        JSONObject uploadTokenPayload=success(request("GET",projectPath+"/upload-token",apiToken,null,null),200,"Could not authorize the Pages asset upload.");
        JSONObject uploadTokenResult=uploadTokenPayload.optJSONObject("result");String uploadJwt=uploadTokenResult==null?"":uploadTokenResult.optString("jwt","");
        if(uploadJwt.isEmpty()||uploadJwt.length()>8192||containsWhitespace(uploadJwt))throw new IllegalStateException("Cloudflare did not return a valid temporary asset token.");

        JSONArray hashes=new JSONArray();for(Asset asset:uniqueAssets.values())hashes.put(asset.hash);
        JSONObject missingResponse=success(request("POST",API_BASE+"/pages/assets/check-missing",uploadJwt,"application/json",new JSONObject().put("hashes",hashes).toString().getBytes(StandardCharsets.UTF_8)),200,"Could not check the Pages asset store.");
        JSONArray missingArray=missingResponse.optJSONArray("result");if(missingArray==null)throw new IllegalStateException("Cloudflare returned an invalid missing-asset list.");
        Map<String,Asset> missing=new LinkedHashMap<>();for(int i=0;i<missingArray.length();i++){
            String hash=missingArray.optString(i,null);Asset asset=hash==null?null:uniqueAssets.get(hash);
            if(asset==null||missing.put(hash,asset)!=null)throw new IllegalStateException("Cloudflare returned an unexpected missing-asset hash.");
        }
        for(List<Asset> batch:makeBatches(missing.values())){
            JSONArray payload=new JSONArray();JSONArray batchHashes=new JSONArray();
            for(Asset asset:batch){
                String encoded=Base64.getEncoder().encodeToString(asset.content);
                payload.put(new JSONObject().put("base64",true).put("key",asset.hash)
                        .put("metadata",new JSONObject().put("contentType",asset.contentType)).put("value",encoded));
                batchHashes.put(asset.hash);
            }
            byte[] uploadBody=payload.toString().getBytes(StandardCharsets.UTF_8);
            if(uploadBody.length>MAX_REQUEST_BYTES)throw new IllegalArgumentException("A Pages asset batch exceeds the upload size limit.");
            success(request("POST",API_BASE+"/pages/assets/upload",uploadJwt,"application/json",uploadBody),200,"Could not upload Pages assets.");
            success(request("POST",API_BASE+"/pages/assets/upsert-hashes",uploadJwt,"application/json",new JSONObject().put("hashes",batchHashes).toString().getBytes(StandardCharsets.UTF_8)),200,"Could not register uploaded Pages assets.");
        }

        JSONObject cloudflareManifest=new JSONObject();for(Map.Entry<String,CloudflareArtifactManifest.Asset> entry:manifest.assets.entrySet())cloudflareManifest.put(entry.getKey(),entry.getValue().pagesHash);
        Multipart multipart=deploymentMultipart(cloudflareManifest.toString(),sourceRevision);
        JSONObject deploymentPayload=success(request("POST",projectPath+"/deployments",apiToken,"multipart/form-data; boundary="+multipart.boundary,multipart.body),200,"Cloudflare did not accept the preview deployment.");
        JSONObject result=deploymentPayload.optJSONObject("result");if(result==null)throw new IllegalStateException("Cloudflare returned no preview deployment metadata.");
        String id=result.optString("id","");String environment=result.optString("environment","");String url=result.optString("url","");
        JSONObject trigger=result.optJSONObject("deployment_trigger"),metadata=trigger==null?null:trigger.optJSONObject("metadata");String branch=metadata==null?"":metadata.optString("branch","");
        if(!id.matches("[a-f0-9-]{8,64}")||!"preview".equalsIgnoreCase(environment)||!PREVIEW_BRANCH.equals(branch)||!sourceRevision.equals(metadata==null?"":metadata.optString("commit_hash",""))||metadata==null||metadata.optBoolean("commit_dirty",true)||!isExpectedPreviewUrl(url,projectName))
            throw new IllegalStateException("Cloudflare deployment metadata did not match the confirmed preview project and branch.");
        return new Deployment(id,url,branch,sourceRevision);
    }

    private Multipart deploymentMultipart(String manifest,String revision)throws Exception{
        String boundary="StudioPages-"+UUID.randomUUID().toString().replace("-","");ByteArrayOutputStream body=new ByteArrayOutputStream();
        form(body,boundary,"manifest",manifest);form(body,boundary,"branch",PREVIEW_BRANCH);form(body,boundary,"commit_dirty","false");form(body,boundary,"commit_hash",revision);form(body,boundary,"commit_message","Astro Static Studio build "+revision);
        body.write(("--"+boundary+"--\r\n").getBytes(StandardCharsets.US_ASCII));byte[] bytes=body.toByteArray();
        if(bytes.length>MAX_REQUEST_BYTES)throw new IllegalArgumentException("The Pages deployment manifest exceeds the request size limit.");return new Multipart(boundary,bytes);
    }
    private void form(ByteArrayOutputStream body,String boundary,String name,String value)throws Exception{
        body.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n").getBytes(StandardCharsets.UTF_8));
    }
    private Response request(String method,String url,String token,String contentType,byte[] body)throws Exception{
        validateApiUrl(url);if(token==null||token.isEmpty()||containsWhitespace(token))throw new IllegalStateException("Cloudflare authorization is unavailable.");
        if(body!=null&&body.length>MAX_REQUEST_BYTES)throw new IllegalArgumentException("The Cloudflare API request exceeds the supported size.");
        Response response=transport.execute(method,url,token,contentType,body);
        if(response==null||response.status<200||response.status>=300)throw new CloudflareApiException(response==null?0:response.status,"Cloudflare rejected the Pages upload request.");
        return response;
    }
    private JSONObject success(Response response,int expectedStatus,String fallback)throws Exception{
        if(response.status!=expectedStatus||!response.json.optBoolean("success",false))throw new CloudflareApiException(response.status,fallback);
        return response.json;
    }
    private static Map<String,Asset> assetsForUpload(CloudflareArtifactManifest manifest,Map<String,byte[]> files)throws Exception{
        Map<String,Asset> byHash=new TreeMap<>();
        for(Map.Entry<String,CloudflareArtifactManifest.Asset> entry:manifest.assets.entrySet()){
            byte[] content=files.get(entry.getKey());if(content==null||content.length>GithubArtifactArchive.MAX_FILE_BYTES)throw new IllegalStateException("A manifest asset is missing or too large.");
            Asset asset=new Asset(entry.getKey(),entry.getValue().pagesHash,contentType(entry.getKey()),content);Asset previous=byHash.get(asset.hash);
            if(previous==null)byHash.put(asset.hash,asset);else if(!java.util.Arrays.equals(previous.content,content)||!extension(previous.path).equals(extension(asset.path)))throw new SecurityException("Files with one Cloudflare asset key do not match.");
        }
        return byHash;
    }
    private static List<List<Asset>> makeBatches(Iterable<Asset> assets){
        List<List<Asset>> batches=new ArrayList<>();List<Asset> current=new ArrayList<>();int raw=0;
        for(Asset asset:assets){if(!current.isEmpty()&&(current.size()>=MAX_BATCH_FILES||raw+asset.content.length>MAX_BATCH_RAW_BYTES)){batches.add(current);current=new ArrayList<>();raw=0;}current.add(asset);raw+=asset.content.length;}
        if(!current.isEmpty())batches.add(current);return batches;
    }
    private static void validateInputs(String accountId,String projectName,String token){
        if(accountId==null||!accountId.matches("[A-Fa-f0-9]{32}"))throw new IllegalArgumentException("A verified Cloudflare account ID is required.");
        if(projectName==null||!projectName.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"))throw new IllegalArgumentException("A valid selected Pages project is required.");
        if(token==null||token.isEmpty()||!token.equals(token.trim())||containsWhitespace(token)||token.regionMatches(true,0,"Bearer ",0,7))throw new IllegalArgumentException("A native Cloudflare Pages Write token is required for this call.");
    }
    private static void validateOutputPaths(Map<String,byte[]> files)throws Exception{
        if(files.isEmpty()||files.size()>GithubArtifactArchive.MAX_ENTRIES)throw new IllegalArgumentException("The verified site contains an unsupported number of files.");
        for(String path:files.keySet()){
            GithubArtifactArchive.validateRelativeFilePath(path);String lower=path.toLowerCase(Locale.ROOT);
            if(lower.equals("_headers")||lower.equals("_redirects")||lower.equals("_routes.json")||lower.equals("_worker.js")||lower.equals("_worker.bundle")||
                    lower.equals("functions")||lower.startsWith("functions/")||lower.startsWith(".wrangler/")||lower.equals(".ds_store")||
                    java.util.Arrays.asList(path.split("/")).contains("node_modules")||java.util.Arrays.asList(path.split("/")).contains(".git")||
                    lower.matches("(^|.*/)\\.env(?:\\..*)?$"))throw new IllegalArgumentException("The static artifact contains a Cloudflare control or unsupported file path.");
        }
    }
    private static String contentType(String path){String ext=extension(path).toLowerCase(Locale.ROOT);switch(ext){
        case "html":case "htm":return "text/html";case "css":return "text/css";case "js":case "mjs":case "cjs":return "application/javascript";
        case "json":case "map":return "application/json";case "svg":return "image/svg+xml";case "png":return "image/png";case "jpg":case "jpeg":return "image/jpeg";
        case "gif":return "image/gif";case "webp":return "image/webp";case "ico":return "image/x-icon";case "woff":return "font/woff";case "woff2":return "font/woff2";
        case "ttf":return "font/ttf";case "otf":return "font/otf";case "wasm":return "application/wasm";case "xml":return "application/xml";case "txt":return "text/plain";
        case "webmanifest":return "application/manifest+json";case "pdf":return "application/pdf";case "avif":return "image/avif";default:return "application/octet-stream";}}
    private static String extension(String path){int slash=path.lastIndexOf('/'),dot=path.lastIndexOf('.');return dot<=slash?"":path.substring(dot+1);}
    private static boolean allowsPreviewBranch(JSONObject project){
        String setting=project.optString("preview_deployment_setting","");if("none".equals(setting))return false;if("all".equals(setting))return true;if(!"custom".equals(setting))return false;
        JSONArray includes=project.optJSONArray("preview_branch_includes");if(includes==null)return false;
        for(int i=0;i<includes.length();i++){String pattern=includes.optString(i,"");if("*".equals(pattern)||PREVIEW_BRANCH.equals(pattern))return true;
            String regex=java.util.regex.Pattern.quote(pattern).replace("\\Q*\\E",".*");if(PREVIEW_BRANCH.matches(regex))return true;}
        return false;
    }
    private static boolean containsWhitespace(String value){for(int i=0;i<value.length();i++)if(Character.isWhitespace(value.charAt(i))||Character.isISOControl(value.charAt(i)))return true;return false;}
    private static boolean isExpectedPreviewUrl(String value,String projectName){try{URI uri=new URI(value);String host=uri.getHost();return "https".equalsIgnoreCase(uri.getScheme())&&host!=null&&
            (host.equalsIgnoreCase(PREVIEW_BRANCH+"."+projectName+".pages.dev")||host.matches("(?i)[a-f0-9]{8,64}\\."+java.util.regex.Pattern.quote(projectName)+"\\.pages\\.dev"))&&
            uri.getUserInfo()==null&&uri.getPort()==-1&&uri.getQuery()==null&&uri.getFragment()==null;}catch(Exception error){return false;}}
    private static void validateApiUrl(String value)throws Exception{URI uri=new URI(value);String path=uri.getRawPath();if(!"https".equalsIgnoreCase(uri.getScheme())||!"api.cloudflare.com".equalsIgnoreCase(uri.getHost())||uri.getUserInfo()!=null||uri.getPort()!=-1||uri.getQuery()!=null||uri.getFragment()!=null||path==null||!path.equals(uri.getPath())||!path.startsWith("/client/v4/")||path.contains("//")||path.contains("/../")||path.endsWith("/..")||path.contains("/./")||path.endsWith("/."))throw new SecurityException("Cloudflare requests must use the fixed HTTPS API origin.");}
    private static final class CloudflareApiException extends Exception {final int status;CloudflareApiException(int status,String message){super(message);this.status=status;}}

    static final class HttpTransport implements Transport {
        @Override public Response execute(String method,String address,String bearer,String contentType,byte[] body)throws Exception{
            validateApiUrl(address);if(!"GET".equals(method)&&!"POST".equals(method))throw new IllegalArgumentException("Unsupported Cloudflare API method.");
            HttpURLConnection connection=(HttpURLConnection)new URL(address).openConnection();connection.setRequestMethod(method);connection.setConnectTimeout(15000);connection.setReadTimeout(120000);connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
            connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Authorization","Bearer "+bearer);
            if(contentType!=null)connection.setRequestProperty("Content-Type",contentType);
            if(body!=null){if(body.length>MAX_REQUEST_BYTES)throw new IllegalArgumentException("Cloudflare API request exceeds the supported size.");connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);try(OutputStream output=connection.getOutputStream()){output.write(body);}}
            try{
                int status=connection.getResponseCode();InputStream input=status>=200&&status<300?connection.getInputStream():connection.getErrorStream();byte[] bytes=new byte[0];
                if(input!=null){try{ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(output.size()+count>MAX_RESPONSE_BYTES)throw new IllegalStateException("Cloudflare response exceeded the supported size.");output.write(buffer,0,count);}bytes=output.toByteArray();}finally{input.close();}}
                JSONObject json=status>=200&&status<300?new JSONObject(bytes.length==0?"{}":new String(bytes,StandardCharsets.UTF_8)):new JSONObject();return new Response(status,json);
            }finally{connection.disconnect();}
        }
    }
}
