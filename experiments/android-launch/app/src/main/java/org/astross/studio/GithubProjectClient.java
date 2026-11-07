package org.astross.studio;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Narrow GitHub boundary for one owner-created private project and its canonical content file. */
final class GithubProjectClient {
    static final String CONTENT_PATH="content/content.json";
    private static final String USER_INSTALLATIONS_URL="https://api.github.com/user/installations?per_page=100";
    static final int MAX_CONTENT_BYTES=1_000_000;
    interface Transport { Response execute(String method,String url,String token,JSONObject body)throws Exception; }
    interface RequestGuard { boolean isCurrent(); }
    interface BeforeCreate { void persist()throws Exception; }
    static final class Response {
        final int status; final JSONObject json; final String acceptedPermissions;
        Response(int status,JSONObject json){this(status,json,"");}
        Response(int status,JSONObject json,String acceptedPermissions){this.status=status;this.json=json;this.acceptedPermissions=acceptedPermissions==null?"":acceptedPermissions;}
    }
    static final class Binding {
        final long id,ownerId; final String owner,name,branch;
        Binding(long id,String owner,String name,String branch){this(id,1,owner,name,branch);}
        Binding(long id,long ownerId,String owner,String name,String branch){this.id=id;this.ownerId=ownerId;this.owner=owner;this.name=name;this.branch=branch;}
        JSONObject json()throws Exception{return new JSONObject().put("id",id).put("owner_id",ownerId).put("owner",owner).put("name",name).put("branch",branch);}
    }
    static final class Content {
        final JSONObject value; final String sha;
        Content(JSONObject value,String sha){this.value=value;this.sha=sha;}
        JSONObject json()throws Exception{return new JSONObject().put("content",value).put("sha",sha);}
    }
    static final class ApiException extends Exception {
        final int status;
        ApiException(int status,String message){super(message);this.status=status;}
    }
    static final class ConflictException extends Exception {
        final Content remote;
        ConflictException(Content remote){super("GitHub content changed since this draft was loaded. Your draft is preserved; review both versions before saving again.");this.remote=remote;}
    }

    private final Transport transport;
    private final RequestGuard guard;
    private final GithubContentValidator validator;
    private final long expectedAppId;
    private final String templateOwner,templateRepo;
    private final long templateRepositoryId;
    GithubProjectClient(){this(new HttpTransport(),()->true,classpathValidator(),BuildConfig.GITHUB_APP_ID,BuildConfig.SITE_TEMPLATE_OWNER,BuildConfig.SITE_TEMPLATE_REPO,BuildConfig.SITE_TEMPLATE_REPOSITORY_ID);}
    GithubProjectClient(Transport transport){this(transport,()->true,classpathValidator(),BuildConfig.GITHUB_APP_ID,BuildConfig.SITE_TEMPLATE_OWNER,BuildConfig.SITE_TEMPLATE_REPO,BuildConfig.SITE_TEMPLATE_REPOSITORY_ID);}
    GithubProjectClient(RequestGuard guard){this(new HttpTransport(),guard,classpathValidator(),BuildConfig.GITHUB_APP_ID,BuildConfig.SITE_TEMPLATE_OWNER,BuildConfig.SITE_TEMPLATE_REPO,BuildConfig.SITE_TEMPLATE_REPOSITORY_ID);}
    GithubProjectClient(Transport transport,RequestGuard guard){this(transport,guard,classpathValidator(),BuildConfig.GITHUB_APP_ID,BuildConfig.SITE_TEMPLATE_OWNER,BuildConfig.SITE_TEMPLATE_REPO,BuildConfig.SITE_TEMPLATE_REPOSITORY_ID);}
    GithubProjectClient(RequestGuard guard,GithubContentValidator validator){this(new HttpTransport(),guard,validator,BuildConfig.GITHUB_APP_ID,BuildConfig.SITE_TEMPLATE_OWNER,BuildConfig.SITE_TEMPLATE_REPO,BuildConfig.SITE_TEMPLATE_REPOSITORY_ID);}
    GithubProjectClient(Transport transport,long expectedAppId,String templateOwner,String templateRepo,long templateRepositoryId){this(transport,()->true,classpathValidator(),expectedAppId,templateOwner,templateRepo,templateRepositoryId);}
    GithubProjectClient(Transport transport,RequestGuard guard,GithubContentValidator validator){this(transport,guard,validator,BuildConfig.GITHUB_APP_ID,BuildConfig.SITE_TEMPLATE_OWNER,BuildConfig.SITE_TEMPLATE_REPO,BuildConfig.SITE_TEMPLATE_REPOSITORY_ID);}
    private GithubProjectClient(Transport transport,RequestGuard guard,GithubContentValidator validator,long expectedAppId,String templateOwner,String templateRepo,long templateRepositoryId){this.transport=transport;this.guard=guard;this.validator=validator;this.expectedAppId=expectedAppId;this.templateOwner=templateOwner;this.templateRepo=templateRepo;this.templateRepositoryId=templateRepositoryId;}
    private static GithubContentValidator classpathValidator(){try{return GithubContentValidator.from(GithubProjectClient.class.getResourceAsStream("/content.schema.json"),GithubProjectClient.class.getResourceAsStream("/content-invariants.json"));}catch(Exception e){throw new IllegalStateException("Canonical content validator is unavailable.",e);}}
    private Response request(String method,String url,String token,JSONObject body)throws Exception{
        if(!guard.isCurrent())throw new IllegalStateException("This GitHub operation was cancelled before the next request.");
        return transport.execute(method,url,token,body);
    }

    Binding createPrivate(String token,String login,String name)throws Exception{return createPrivate(token,login,name,1,()->{});}
    Binding createPrivate(String token,String login,String name,long ownerId)throws Exception{return createPrivate(token,login,name,ownerId,()->{});}
    Binding createPrivate(String token,String login,String name,long ownerId,BeforeCreate beforeCreate)throws Exception{
        validateLogin(login);validateRepositoryName(name);if(ownerId<=0)throw new IllegalArgumentException("Verified GitHub account ID is required.");
        Response existing=request("GET","https://api.github.com/repos/"+login+"/"+name,token,null);
        if(existing.status>=200&&existing.status<300)throw new ApiException(409,"A repository with this name already exists and was not changed.");
        if(existing.status!=404)throw apiError(existing,"Could not safely check this repository name. No repository was created.");
        String installationState=verifyCurrentInstallation(token,login,ownerId);
        verifyApprovedTemplate(token);
        beforeCreate.persist();
        JSONObject request=new JSONObject().put("owner",login).put("name",name).put("private",true).put("include_all_branches",false).put("description","Astro Static Studio site");
        Response response=this.request("POST","https://api.github.com/repos/"+templateOwner+"/"+templateRepo+"/generate",token,request);
        if(response.status<200||response.status>=300)throw apiError(response,"Could not create the private site from the approved template. Check the app permissions and repository name.",installationState);
        Binding binding=parseBinding(response.json,0,ownerId,login,name);
        verify(binding,token,login,ownerId);
        return binding;
    }

    private void verifyApprovedTemplate(String token)throws Exception{
        if(templateOwner==null||!templateOwner.matches("[A-Za-z0-9-]{1,39}")||templateRepo==null||!templateRepo.matches("[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?")||templateRepositoryId<=0)
            throw new ApiException(0,"The approved site template is not configured. No repository was created.");
        Response response=request("GET","https://api.github.com/repos/"+templateOwner+"/"+templateRepo,token,null);
        if(response.status<200||response.status>=300)throw apiError(response,"Could not verify the approved site template. No repository was created.");
        JSONObject repository=response.json;JSONObject owner=repository.optJSONObject("owner");
        if(repository.optLong("id",0)!=templateRepositoryId||!repository.optString("name","").equalsIgnoreCase(templateRepo)||owner==null||!owner.optString("login","").equalsIgnoreCase(templateOwner)||!repository.optBoolean("is_template",false)||repository.optBoolean("private",true))
            throw new ApiException(409,"The configured public site template did not match the reviewed template. No repository was created.");
    }

    /** Read-only check used to explain whether the verified account has installed this GitHub App. */
    String checkCurrentInstallation(String token,String login,long ownerId)throws Exception{
        validateLogin(login);if(ownerId<=0)throw new IllegalArgumentException("Verified GitHub account ID is required.");
        return verifyCurrentInstallation(token,login,ownerId);
    }

    /** Verifies pinned immutable ID and private ownership on every operation. */
    Binding verify(Binding binding,String token,String login)throws Exception{return verify(binding,token,login,binding.ownerId);}
    Binding verify(Binding binding,String token,String login,long ownerId)throws Exception{
        validateBinding(binding,login,ownerId);
        Response response=request("GET",repoUrl(binding),token,null);
        if(response.status<200||response.status>=300)throw apiError(response,"The saved private repository is not accessible. Reconnect GitHub or select a project again.");
        Binding current=parseBinding(response.json,binding.id,ownerId,login,binding.name);
        if(!current.branch.equals(binding.branch))throw new ApiException(409,"The private project's default branch changed. Refresh the project binding before saving.");
        return binding;
    }

    Content readContent(Binding binding,String token)throws Exception{
        Response response=request("GET",contentUrl(binding),token,null);
        if(response.status==404)return null;
        if(response.status<200||response.status>=300)throw apiError(response,"Could not read project content from GitHub.");
        JSONObject file=response.json;
        if(!CONTENT_PATH.equals(file.optString("path"))||!"file".equals(file.optString("type")))throw new ApiException(422,"GitHub returned an unexpected project file.");
        String sha=file.optString("sha","");
        if(!sha.matches("[0-9a-f]{40}"))throw new ApiException(422,"GitHub returned an invalid content revision.");
        String encoded=file.optString("content","").replace("\n","");
        byte[] bytes;
        try{bytes=decodeBase64(encoded);}catch(IllegalArgumentException error){throw new ApiException(422,"Project content encoding is invalid.");}
        if(bytes.length>MAX_CONTENT_BYTES)throw new ApiException(413,"Project content is larger than this app supports.");
        JSONObject content;
        try{content=new JSONObject(new String(bytes,StandardCharsets.UTF_8));}catch(Exception error){throw new ApiException(422,"Project content is not valid JSON.");}
        validator.validate(content);
        return new Content(content,sha);
    }

    Content saveContent(Binding binding,String token,String expectedSha,JSONObject value)throws Exception{
        validator.validate(value);
        if(expectedSha==null||!expectedSha.matches("[0-9a-f]{40}"))throw new IllegalArgumentException("A valid expected GitHub revision is required.");
        Content remote=readContent(binding,token);
        if(remote==null||!expectedSha.equals(remote.sha))throw new ConflictException(remote);
        try{return writeFile(binding,token,value,expectedSha);}
        catch(ApiException error){
            if(error.status!=409&&error.status!=422)throw error;
            Content latest=readContent(binding,token);
            if(latest==null||expectedSha.equals(latest.sha))throw error;
            throw new ConflictException(latest);
        }
    }

    Content readContentVerified(Binding binding,String token,String login)throws Exception{return readContentVerified(binding,token,login,binding.ownerId);}
    Content readContentVerified(Binding binding,String token,String login,long ownerId)throws Exception{verify(binding,token,login,ownerId);return readContent(binding,token);}
    Content saveContentVerified(Binding binding,String token,String login,String expectedSha,JSONObject value)throws Exception{return saveContentVerified(binding,token,login,binding.ownerId,expectedSha,value);}
    Content saveContentVerified(Binding binding,String token,String login,long ownerId,String expectedSha,JSONObject value)throws Exception{verify(binding,token,login,ownerId);return saveContent(binding,token,expectedSha,value);}

    private Content writeFile(Binding binding,String token,JSONObject value,String sha)throws Exception{
        byte[] content=value.toString().getBytes(StandardCharsets.UTF_8);validator.validate(value);
        JSONObject body=new JSONObject().put("message",sha==null?"Initialize Astro Static Studio content":"Update Astro Static Studio content")
                .put("content",encodeBase64(content)).put("branch",binding.branch);
        if(sha!=null)body.put("sha",sha);
        Response response=request("PUT",contentUrl(binding),token,body);
        if(response.status==409||response.status==422)throw new ApiException(response.status,"GitHub rejected this content update because the file changed. Reload both versions before retrying.");
        if(response.status<200||response.status>=300)throw apiError(response,"Could not save project content to GitHub.");
        JSONObject file=response.json.optJSONObject("content");String nextSha=file==null?"":file.optString("sha","");
        if(!nextSha.matches("[0-9a-f]{40}"))throw new ApiException(422,"GitHub did not confirm the saved revision.");
        return new Content(value,nextSha);
    }

    static void validateContent(JSONObject content)throws Exception{classpathValidator().validate(content);}
    private static void validateLogin(String login){if(login==null||!login.matches("[A-Za-z0-9-]{1,39}"))throw new IllegalArgumentException("Verified GitHub account is required.");}
    static void validateRepositoryName(String name){if(name==null||!name.matches("[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?"))throw new IllegalArgumentException("Choose a repository name using lowercase letters, numbers, dots, underscores or hyphens.");}
    private static void validateBinding(Binding binding,String login,long ownerId){validateLogin(login);validateRepositoryName(binding.name);if(binding.id<=0||binding.ownerId<=0||binding.ownerId!=ownerId||!binding.owner.equalsIgnoreCase(login)||!binding.branch.matches("[A-Za-z0-9._/-]{1,200}")||binding.branch.startsWith("/")||binding.branch.contains(".."))throw new IllegalArgumentException("Saved GitHub project binding is invalid.");}
    private static Binding parseBinding(JSONObject json,long expectedId,long expectedOwnerId,String login,String expectedName)throws Exception{
        long id=json.optLong("id",0);JSONObject ownerObject=json.optJSONObject("owner");String owner=ownerObject!=null?ownerObject.optString("login",""):"";long ownerId=ownerObject==null?0:ownerObject.optLong("id",0);
        String name=json.optString("name","");String branch=json.optString("default_branch","");
        if(id<=0||ownerId<=0||(expectedId>0&&id!=expectedId)||(expectedOwnerId>0&&ownerId!=expectedOwnerId)||!owner.equalsIgnoreCase(login)||!name.equals(expectedName)||!json.optBoolean("private",false)||branch.isEmpty())
            throw new ApiException(403,"GitHub project identity did not match the confirmed private repository.");
        return new Binding(id,ownerId,owner,name,branch);
    }
    private static String repoUrl(Binding binding){return "https://api.github.com/repos/"+binding.owner+"/"+binding.name;}
    private static String contentUrl(Binding binding){return repoUrl(binding)+"/contents/"+CONTENT_PATH;}
    private String verifyCurrentInstallation(String token,String login,long ownerId)throws Exception{
        if(expectedAppId<=0)throw new ApiException(0,"The GitHub App ID is not configured for this build; no repository was created.");
        Response response=request("GET",USER_INSTALLATIONS_URL,token,null);
        if(response.status<200||response.status>=300)throw apiError(response,"Could not verify this app's installation on the signed-in GitHub account. No repository was created.");
        JSONArray installations=response.json.optJSONArray("installations");int total=response.json.optInt("total_count",-1);
        if(installations==null||total<0||total>installations.length())throw new ApiException(0,"GitHub did not return a complete installation list. No repository was created.");
        JSONObject match=null;
        for(int index=0;index<installations.length();index++){
            JSONObject installation=installations.optJSONObject(index);if(installation!=null&&installation.optLong("app_id",0)==expectedAppId){
                JSONObject account=installation.optJSONObject("account");
                if(account!=null&&account.optLong("id",0)==ownerId&&account.optString("login","").equalsIgnoreCase(login))match=installation;
            }
        }
        if(match==null)throw new ApiException(403,"This GitHub account has no installation of this app. Install and approve the app for this account before creating a repository.");
        JSONObject permissions=match.optJSONObject("permissions");
        if(permissions==null)throw new ApiException(0,"GitHub did not return this app installation's permissions. No repository was created.");
        if(!"write".equals(permissions.optString("repository_creation","")))throw new ApiException(403,"This GitHub app installation lacks Repository creation: write. Approve the updated permission in GitHub before creating a repository.");
        if(!"write".equals(permissions.optString("contents","")))throw new ApiException(403,"This GitHub app installation lacks Contents: write. Approve the updated permission in GitHub before creating or saving project content.");
        return "installation verified; Repository creation: write; Contents: write";
    }

    private static ApiException apiError(Response response,String fallback){return apiError(response,fallback,"");}
    private static ApiException apiError(Response response,String fallback,String context){
        StringBuilder message=new StringBuilder(fallback).append(" (GitHub HTTP ").append(response.status);
        if(context!=null&&!context.isEmpty())message.append("; ").append(context);
        String code=safeErrorCode(response.json.optString("message",""));if(!code.isEmpty())message.append("; code ").append(code);
        String permissions=sanitizeAcceptedPermissions(response.acceptedPermissions);if(!permissions.isEmpty())message.append("; endpoint requires ").append(permissions);
        return new ApiException(response.status,message.append(')').toString());
    }
    static String safeErrorCode(String message){
        if(message==null)return "";
        switch(message.trim().toLowerCase(java.util.Locale.ROOT)){
            case "resource not accessible by integration":case "resource not accessible by personal access token":return "resource_not_accessible";
            case "validation failed":return "validation_failed";
            case "not found":return "not_found";
            default:return "";
        }
    }
    static String sanitizeAcceptedPermissions(String value){
        if(value==null||value.isEmpty()||value.length()>256)return "";
        StringBuilder safe=new StringBuilder();String[] alternatives=value.split(";",-1);
        for(int groupIndex=0;groupIndex<alternatives.length;groupIndex++){
            if(groupIndex>0)safe.append("; ");String[] entries=alternatives[groupIndex].split(",",-1);
            for(int entryIndex=0;entryIndex<entries.length;entryIndex++){
                String entry=entries[entryIndex].trim().toLowerCase(java.util.Locale.ROOT);
                if(!entry.matches("[a-z][a-z0-9_-]{0,63}=(read|write)"))return "";
                if(entryIndex>0)safe.append(", ");safe.append(entry);
            }
        }
        return safe.toString();
    }
    private static void validateNestedPaths(Object value,int depth)throws Exception{
        if(depth>60)throw new IllegalArgumentException("Project content nesting is too deep.");
        if(value instanceof JSONObject){JSONObject object=(JSONObject)value;java.util.Iterator<String> keys=object.keys();while(keys.hasNext()){String key=keys.next();Object child=object.get(key);if("src".equals(key)){if(!(child instanceof String)||!((String)child).matches("/media/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.webp"))throw new IllegalArgumentException("Project content contains an invalid media path.");}if("href".equals(key)){if(!(child instanceof String)||!safeHref((String)child))throw new IllegalArgumentException("Project content contains an invalid link.");}validateNestedPaths(child,depth+1);}}
        else if(value instanceof JSONArray){JSONArray array=(JSONArray)value;for(int i=0;i<array.length();i++)validateNestedPaths(array.get(i),depth+1);}
    }
    private static final char[] BASE64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();
    private static String encodeBase64(byte[] input){StringBuilder out=new StringBuilder((input.length+2)/3*4);for(int i=0;i<input.length;i+=3){int a=input[i]&255,b=i+1<input.length?input[i+1]&255:0,c=i+2<input.length?input[i+2]&255:0;out.append(BASE64[a>>>2]).append(BASE64[((a&3)<<4)|(b>>>4)]).append(i+1<input.length?BASE64[((b&15)<<2)|(c>>>6)]:'=').append(i+2<input.length?BASE64[c&63]:'=');}return out.toString();}
    private static byte[] decodeBase64(String input){String value=input.replaceAll("\\s","");if(value.length()%4!=0)throw new IllegalArgumentException("bad base64 length");ByteArrayOutputStream out=new ByteArrayOutputStream();for(int i=0;i<value.length();i+=4){int a=base64Value(value.charAt(i)),b=base64Value(value.charAt(i+1)),c=value.charAt(i+2)=='='?0:base64Value(value.charAt(i+2)),d=value.charAt(i+3)=='='?0:base64Value(value.charAt(i+3));if(a<0||b<0||c<0||d<0)throw new IllegalArgumentException("bad base64 char");out.write((a<<2)|(b>>>4));if(value.charAt(i+2)!='=')out.write((b<<4)|(c>>>2));if(value.charAt(i+3)!='=')out.write((c<<6)|d);}return out.toByteArray();}
    private static int base64Value(char value){if(value>='A'&&value<='Z')return value-'A';if(value>='a'&&value<='z')return value-'a'+26;if(value>='0'&&value<='9')return value-'0'+52;if(value=='+')return 62;if(value=='/')return 63;return -1;}
    private static boolean safeHref(String href){if(href.isEmpty()||href.length()>2000||!href.equals(href.trim()))return false;if(href.startsWith("/"))return !href.startsWith("//")&&!href.contains("\\");try{java.net.URI uri=new java.net.URI(href);String scheme=uri.getScheme();if(scheme==null)return false;scheme=scheme.toLowerCase(java.util.Locale.ROOT);if("http".equals(scheme)||"https".equals(scheme))return uri.getHost()!=null;return "mailto".equals(scheme)||"tel".equals(scheme);}catch(Exception error){return false;}}

    static final class HttpTransport implements Transport {
        @Override public Response execute(String method,String url,String token,JSONObject body)throws Exception{
            HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();connection.setRequestMethod(method);connection.setConnectTimeout(12000);connection.setReadTimeout(20000);connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept","application/vnd.github+json");connection.setRequestProperty("Authorization","Bearer "+token);connection.setRequestProperty("X-GitHub-Api-Version","2022-11-28");
            if(body!=null){connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json; charset=utf-8");try(OutputStream output=connection.getOutputStream()){output.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
            int status=connection.getResponseCode();String acceptedPermissions=connection.getHeaderField("X-Accepted-GitHub-Permissions");InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();if(input!=null){try(input){byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))>0){if(bytes.size()+count>MAX_CONTENT_BYTES*2)throw new IllegalStateException("GitHub response is too large.");bytes.write(buffer,0,count);}}}
            JSONObject json=new JSONObject(bytes.toString(StandardCharsets.UTF_8).isEmpty()?"{}":bytes.toString(StandardCharsets.UTF_8));connection.disconnect();return new Response(status,json,acceptedPermissions);
        }
    }
}
