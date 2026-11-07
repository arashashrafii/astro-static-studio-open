package org.astross.studio;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import static org.junit.Assert.*;

public final class CloudflarePagesDirectUploadClientTest {
    private static final String ACCOUNT="0123456789abcdef0123456789abcdef";
    private static final String PROJECT="studio-preview-test";
    private static final String REVISION="0123456789abcdef0123456789abcdef01234567";
    private static final String WORKFLOW_REVISION="fedcba9876543210fedcba9876543210fedcba98";
    private static final String API_TOKEN="caller-pages-write-token";
    private static final String UPLOAD_JWT="short-lived-upload-jwt";
    private static final byte[] INDEX="<h1>preview</h1>".getBytes(StandardCharsets.UTF_8);
    private static final byte[] JS="console.log('preview')".getBytes(StandardCharsets.UTF_8);
    private static final String INDEX_HASH=CloudflareArtifactManifest.pagesHash(INDEX,"index.html");
    private static final String JS_HASH=CloudflareArtifactManifest.pagesHash(JS,"assets/app.js");

    private static GithubArtifactArchive.VerifiedSite site() throws Exception {
        JSONObject assets=new JSONObject().put("index.html",asset(INDEX_HASH,INDEX)).put("assets/app.js",asset(JS_HASH,JS));
        JSONObject generated=new JSONObject().put("schemaVersion",2).put("assetIdentity",CloudflareArtifactManifest.ASSET_IDENTITY).put("sourceRevision",REVISION).put("workflowRevision",WORKFLOW_REVISION).put("assets",assets);
        Map<String,byte[]> files=new LinkedHashMap<>();files.put("index.html",INDEX);files.put("assets/app.js",JS);
        files.put(CloudflareArtifactManifest.FILE_PATH,generated.toString().getBytes(StandardCharsets.UTF_8));
        return new GithubArtifactArchive.VerifiedSite(files).withVerifiedRevisions(REVISION,WORKFLOW_REVISION);
    }
    private static JSONObject asset(String pagesHash,byte[] bytes)throws Exception{return new JSONObject().put("pagesHash",pagesHash).put("sha256",hex(MessageDigest.getInstance("SHA-256").digest(bytes)));}

    private static class MockTransport implements CloudflarePagesDirectUploadClient.Transport {
        final List<String> methods=new ArrayList<>(),urls=new ArrayList<>(),tokens=new ArrayList<>(),types=new ArrayList<>();
        final List<byte[]> bodies=new ArrayList<>();int failAt=-1,call;String productionBranch="main",previewSetting="all";
        @Override public CloudflarePagesDirectUploadClient.Response execute(String method,String url,String token,String contentType,byte[] body)throws Exception{
            methods.add(method);urls.add(url);tokens.add(token);types.add(contentType);bodies.add(body==null?null:body.clone());
            int current=call++;
            if(current==failAt)return new CloudflarePagesDirectUploadClient.Response(403,new JSONObject().put("success",false));
            if("GET".equals(method)&&url.endsWith("/projects/"+PROJECT))return new CloudflarePagesDirectUploadClient.Response(200,new JSONObject().put("success",true).put("result",new JSONObject()
                    .put("name",PROJECT).put("production_branch",productionBranch).put("preview_deployment_setting",previewSetting)));
            if(url.endsWith("/upload-token"))return new CloudflarePagesDirectUploadClient.Response(200,new JSONObject().put("success",true).put("result",new JSONObject().put("jwt",UPLOAD_JWT)));
            if(url.endsWith("/check-missing"))return new CloudflarePagesDirectUploadClient.Response(200,new JSONObject().put("success",true).put("result",new JSONArray().put(INDEX_HASH).put(JS_HASH)));
            if(url.endsWith("/upload"))return new CloudflarePagesDirectUploadClient.Response(200,new JSONObject().put("success",true).put("result",new JSONArray()));
            if(url.endsWith("/upsert-hashes"))return new CloudflarePagesDirectUploadClient.Response(200,new JSONObject().put("success",true).put("result",new JSONArray()));
            if(url.endsWith("/deployments")){
                JSONObject metadata=new JSONObject().put("branch",CloudflarePagesDirectUploadClient.PREVIEW_BRANCH).put("commit_hash",REVISION).put("commit_dirty",false);
                JSONObject result=new JSONObject().put("id","12345678-1234-1234-1234-123456789abc").put("environment","preview")
                        .put("url","https://"+CloudflarePagesDirectUploadClient.PREVIEW_BRANCH+"."+PROJECT+".pages.dev")
                        .put("deployment_trigger",new JSONObject().put("metadata",metadata));
                return new CloudflarePagesDirectUploadClient.Response(200,new JSONObject().put("success",true).put("result",result));
            }
            throw new AssertionError("Unexpected Cloudflare endpoint: "+url);
        }
    }

    @Test public void deploysOnlyManifestAssetsUsingScopedTokensAndFixedPreviewBranch()throws Exception{
        MockTransport transport=new MockTransport();CloudflarePagesDirectUploadClient.Deployment result=
                new CloudflarePagesDirectUploadClient(transport).deployPreview(ACCOUNT,PROJECT,API_TOKEN,site());
        assertEquals("12345678-1234-1234-1234-123456789abc",result.id);assertEquals(REVISION,result.revision);
        assertEquals(6,transport.urls.size());
        assertEquals(API_TOKEN,transport.tokens.get(0));assertTrue(transport.urls.get(0).endsWith("/projects/"+PROJECT));
        assertEquals(API_TOKEN,transport.tokens.get(1));assertTrue(transport.urls.get(1).endsWith("/upload-token"));
        for(int i=2;i<=4;i++)assertEquals(UPLOAD_JWT,transport.tokens.get(i));
        assertEquals(API_TOKEN,transport.tokens.get(5));assertTrue(transport.urls.get(5).endsWith("/deployments"));
        JSONObject uploaded=new JSONArray(new String(transport.bodies.get(3),StandardCharsets.UTF_8)).getJSONObject(0);
        assertFalse(uploaded.toString().contains(CloudflareArtifactManifest.FILE_PATH));
        String deploymentBody=new String(transport.bodies.get(5),StandardCharsets.UTF_8);
        assertTrue(deploymentBody.contains("name=\"branch\"\r\n\r\n"+CloudflarePagesDirectUploadClient.PREVIEW_BRANCH));
        assertTrue(deploymentBody.contains("name=\"commit_hash\"\r\n\r\n"+REVISION));
        assertTrue(deploymentBody.contains("\"index.html\":\""+INDEX_HASH+"\""));
        assertTrue(deploymentBody.contains("\"assets/app.js\":\""+JS_HASH+"\""));
        assertFalse(deploymentBody.contains(CloudflareArtifactManifest.FILE_PATH));
        assertFalse(deploymentBody.contains(API_TOKEN));assertFalse(deploymentBody.contains(UPLOAD_JWT));
    }

    @Test public void refusesInvalidInputsBeforeNetwork()throws Exception{
        String[][] invalid={{"bad",PROJECT,API_TOKEN},{ACCOUNT,"../repo",API_TOKEN},{ACCOUNT,PROJECT," Bearer token"}};
        for(String[] fields:invalid){MockTransport transport=new MockTransport();try{
            new CloudflarePagesDirectUploadClient(transport).deployPreview(fields[0],fields[1],fields[2],site());fail("invalid input accepted");
        }catch(IllegalArgumentException expected){assertTrue(transport.urls.isEmpty());}}
    }

    @Test public void refusesAnUnboundVerifiedSiteBeforeNetwork()throws Exception{
        GithubArtifactArchive.VerifiedSite unbound=new GithubArtifactArchive.VerifiedSite(site().files());MockTransport transport=new MockTransport();
        try{new CloudflarePagesDirectUploadClient(transport).deployPreview(ACCOUNT,PROJECT,API_TOKEN,unbound);fail("unbound site accepted");}
        catch(IllegalArgumentException expected){assertTrue(transport.urls.isEmpty());}
    }

    @Test public void permissionFailureStopsBeforeAnyDeployment()throws Exception{
        MockTransport transport=new MockTransport();transport.failAt=0;
        try{new CloudflarePagesDirectUploadClient(transport).deployPreview(ACCOUNT,PROJECT,API_TOKEN,site());fail("403 accepted");}
        catch(Exception expected){assertEquals(1,transport.urls.size());assertFalse(transport.urls.get(0).endsWith("/deployments"));}
    }

    @Test public void refusesAProductionPreviewBranchBeforeUploadingAssets()throws Exception{
        MockTransport transport=new MockTransport();transport.productionBranch=CloudflarePagesDirectUploadClient.PREVIEW_BRANCH;
        try{new CloudflarePagesDirectUploadClient(transport).deployPreview(ACCOUNT,PROJECT,API_TOKEN,site());fail("production branch accepted as preview");}
        catch(SecurityException expected){assertEquals(1,transport.urls.size());assertFalse(transport.urls.get(0).endsWith("/upload-token"));}
    }

    @Test public void redirectIsReturnedAsFailureAndNeverFollowed()throws Exception{
        MockTransport transport=new MockTransport(){@Override public CloudflarePagesDirectUploadClient.Response execute(String method,String url,String token,String type,byte[] body)throws Exception{
            urls.add(url);tokens.add(token);return new CloudflarePagesDirectUploadClient.Response(302,new JSONObject().put("success",false));}};
        try{new CloudflarePagesDirectUploadClient(transport).deployPreview(ACCOUNT,PROJECT,API_TOKEN,site());fail("redirect accepted");}
        catch(Exception expected){assertEquals(1,transport.urls.size());}
    }

    @Test public void realTransportRejectsNonHttpsForeignAndPathAliasedUrlsBeforeConnecting()throws Exception{
        String[] invalid={"http://api.cloudflare.com/client/v4/pages/assets/upload","https://example.com/client/v4/pages/assets/upload",
                "https://api.cloudflare.com/client/v4/../../outside","https://api.cloudflare.com/client/v4/pages/assets/upload?next=https://example.com"};
        CloudflarePagesDirectUploadClient.HttpTransport transport=new CloudflarePagesDirectUploadClient.HttpTransport();
        for(String url:invalid)try{transport.execute("GET",url,API_TOKEN,null,null);fail("unsafe Cloudflare URL accepted");}catch(SecurityException expected){}
    }

    @Test public void rejectsPerFileSha256MismatchBeforeAnyCloudflareRequest()throws Exception{
        GithubArtifactArchive.VerifiedSite valid=site();Map<String,byte[]> files=new LinkedHashMap<>(valid.files());files.put("assets/app.js","tampered".getBytes(StandardCharsets.UTF_8));
        GithubArtifactArchive.VerifiedSite tampered=new GithubArtifactArchive.VerifiedSite(files).withVerifiedRevisions(REVISION,WORKFLOW_REVISION);MockTransport transport=new MockTransport();
        try{new CloudflarePagesDirectUploadClient(transport).deployPreview(ACCOUNT,PROJECT,API_TOKEN,tampered);fail("tampered asset accepted");}
        catch(SecurityException expected){assertTrue(expected.getMessage().contains("SHA-256"));assertTrue(transport.urls.isEmpty());}
    }

    @Test public void rejectsManifestSourceRevisionMismatchBeforeAnyCloudflareRequest()throws Exception{
        GithubArtifactArchive.VerifiedSite valid=site();Map<String,byte[]> files=new LinkedHashMap<>(valid.files());
        JSONObject generated=new JSONObject(new String(files.get(CloudflareArtifactManifest.FILE_PATH),StandardCharsets.UTF_8)).put("sourceRevision",WORKFLOW_REVISION);
        files.put(CloudflareArtifactManifest.FILE_PATH,generated.toString().getBytes(StandardCharsets.UTF_8));
        GithubArtifactArchive.VerifiedSite mismatched=new GithubArtifactArchive.VerifiedSite(files).withVerifiedRevisions(REVISION,WORKFLOW_REVISION);MockTransport transport=new MockTransport();
        try{new CloudflarePagesDirectUploadClient(transport).deployPreview(ACCOUNT,PROJECT,API_TOKEN,mismatched);fail("manifest revision mismatch accepted");}
        catch(SecurityException expected){assertTrue(transport.urls.isEmpty());}
    }

    @Test public void rejectsManifestWorkflowRevisionMismatchBeforeAnyCloudflareRequest()throws Exception{
        GithubArtifactArchive.VerifiedSite valid=site();Map<String,byte[]> files=new LinkedHashMap<>(valid.files());
        JSONObject generated=new JSONObject(new String(files.get(CloudflareArtifactManifest.FILE_PATH),StandardCharsets.UTF_8)).put("workflowRevision",REVISION);
        files.put(CloudflareArtifactManifest.FILE_PATH,generated.toString().getBytes(StandardCharsets.UTF_8));
        GithubArtifactArchive.VerifiedSite mismatched=new GithubArtifactArchive.VerifiedSite(files).withVerifiedRevisions(REVISION,WORKFLOW_REVISION);MockTransport transport=new MockTransport();
        try{new CloudflarePagesDirectUploadClient(transport).deployPreview(ACCOUNT,PROJECT,API_TOKEN,mismatched);fail("workflow revision mismatch accepted");}
        catch(SecurityException expected){assertTrue(transport.urls.isEmpty());}
    }

    @Test public void unsupportedCloudflareControlFilesFailBeforeNetwork()throws Exception{
        GithubArtifactArchive.VerifiedSite bad=withExtra("_headers","X-Test: yes");MockTransport transport=new MockTransport();
        try{new CloudflarePagesDirectUploadClient(transport).deployPreview(ACCOUNT,PROJECT,API_TOKEN,bad);fail("Cloudflare control file accepted");}
        catch(IllegalArgumentException expected){assertTrue(transport.urls.isEmpty());}
    }

    private static GithubArtifactArchive.VerifiedSite withExtra(String path,String value)throws Exception{
        byte[] extra=value.getBytes(StandardCharsets.UTF_8);JSONObject assets=new JSONObject().put("index.html",asset(INDEX_HASH,INDEX)).put("assets/app.js",asset(JS_HASH,JS)).put(path,asset(CloudflareArtifactManifest.pagesHash(extra,path),extra));
        JSONObject generated=new JSONObject().put("schemaVersion",2).put("assetIdentity",CloudflareArtifactManifest.ASSET_IDENTITY).put("sourceRevision",REVISION).put("workflowRevision",WORKFLOW_REVISION).put("assets",assets);
        Map<String,byte[]> files=new LinkedHashMap<>();files.put("index.html",INDEX);files.put("assets/app.js",JS);files.put(path,value.getBytes(StandardCharsets.UTF_8));
        files.put(CloudflareArtifactManifest.FILE_PATH,generated.toString().getBytes(StandardCharsets.UTF_8));return new GithubArtifactArchive.VerifiedSite(files).withVerifiedRevisions(REVISION,WORKFLOW_REVISION);
    }
    private static String hex(byte[] bytes){StringBuilder output=new StringBuilder();for(byte value:bytes)output.append(String.format(Locale.ROOT,"%02x",value&255));return output.toString();}
}
