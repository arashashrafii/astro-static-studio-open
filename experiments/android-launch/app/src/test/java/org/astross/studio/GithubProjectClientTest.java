package org.astross.studio;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.Queue;
import java.net.ServerSocket;
import java.net.Socket;
import static org.junit.Assert.*;

public final class GithubProjectClientTest {
    private static final String SHA="0123456789abcdef0123456789abcdef01234567";
    private static final String NEXT="abcdef0123456789abcdef0123456789abcdef01";
    private static final long TEST_APP_ID=4242;
    private static final long TEST_TEMPLATE_REPOSITORY_ID=9898;
    private GithubProjectClient client(Fake fake){return new GithubProjectClient(fake,TEST_APP_ID,"template-owner","site-starter",TEST_TEMPLATE_REPOSITORY_ID);}
    private static final class Fake implements GithubProjectClient.Transport {
        final Queue<GithubProjectClient.Response> responses=new ArrayDeque<>();final java.util.List<String> calls=new java.util.ArrayList<>();
        void add(int status,JSONObject body){add(status,body,"");}
        void add(int status,JSONObject body,String acceptedPermissions){responses.add(new GithubProjectClient.Response(status,body,acceptedPermissions));}
        @Override public GithubProjectClient.Response execute(String method,String url,String token,JSONObject body){
            assertEquals("test-token",token);calls.add(method+" "+url+(body==null?"":" "+body.toString()));return responses.remove();
        }
    }
    private JSONObject repository(String login,String name,boolean isPrivate,long id)throws Exception{
        return new JSONObject().put("id",id).put("name",name).put("private",isPrivate).put("default_branch","main").put("owner",new JSONObject().put("login",login).put("id",1));
    }
    private JSONObject emptyContent()throws Exception{return new JSONObject().put("version",2).put("site",new JSONObject().put("name","My Site").put("tagline","").put("email","").put("phone","").put("language","en").put("direction","ltr")).put("pages",new JSONArray()).put("collections",new JSONArray()).put("items",new JSONArray());}
    private JSONObject contentFile(JSONObject content,String sha)throws Exception{
        return new JSONObject().put("path",GithubProjectClient.CONTENT_PATH).put("type","file").put("sha",sha)
                .put("content",Base64.getMimeEncoder().encodeToString(content.toString().getBytes(StandardCharsets.UTF_8)));
    }
    private void addCurrentInstallation(Fake fake,String login,long ownerId,String repositoryCreation)throws Exception{
        JSONObject installation=new JSONObject().put("app_id",TEST_APP_ID)
                .put("account",new JSONObject().put("login",login).put("id",ownerId))
                .put("permissions",new JSONObject().put("repository_creation",repositoryCreation).put("contents","write"));
        fake.add(200,new JSONObject().put("total_count",1).put("installations",new JSONArray().put(installation)));
    }
    private void addApprovedTemplate(Fake fake)throws Exception{
        fake.add(200,new JSONObject().put("id",TEST_TEMPLATE_REPOSITORY_ID).put("name","site-starter").put("private",false).put("is_template",true).put("owner",new JSONObject().put("login","template-owner")));
    }

    @Test public void createsPrivateRepoFromApprovedTemplateAndReadsCanonicalScaffoldContent()throws Exception{
        Fake fake=new Fake();fake.add(404,new JSONObject());addCurrentInstallation(fake,"octocat",1,"write");addApprovedTemplate(fake);fake.add(201,repository("octocat","my-site",true,123));fake.add(200,repository("octocat","my-site",true,123));fake.add(200,repository("octocat","my-site",true,123));fake.add(200,contentFile(emptyContent(),SHA));
        GithubProjectClient client=client(fake);GithubProjectClient.Binding binding=client.createPrivate("test-token","octocat","my-site");
        assertEquals(123,binding.id);assertEquals(1,binding.ownerId);assertEquals("octocat",binding.owner);assertEquals("my-site",binding.name);
        GithubProjectClient.Content saved=client.readContentVerified(binding,"test-token","octocat",1);assertEquals(SHA,saved.sha);assertEquals(2,saved.value.getInt("version"));
        assertTrue(fake.calls.get(0).startsWith("GET https://api.github.com/repos/octocat/my-site"));
        assertTrue(fake.calls.get(2).startsWith("GET https://api.github.com/repos/template-owner/site-starter"));
        assertTrue(fake.calls.get(3).startsWith("POST https://api.github.com/repos/template-owner/site-starter/generate"));
        assertTrue(fake.calls.get(3).contains("\"private\":true"));assertTrue(fake.calls.get(3).contains("\"owner\":\"octocat\""));
        assertTrue(fake.calls.get(6).contains("/contents/content/content.json"));assertEquals(7,fake.calls.size());
        assertFalse(fake.calls.toString().contains("POST https://api.github.com/user/repos"));
    }

    @Test public void deniesCreateWhenAppPermissionIsMissing()throws Exception{
        Fake fake=new Fake();fake.add(404,new JSONObject());addCurrentInstallation(fake,"octocat",1,"write");addApprovedTemplate(fake);fake.add(403,new JSONObject().put("message","Resource not accessible by integration"),"repository_creation=write");
        try{client(fake).createPrivate("test-token","octocat","my-site");fail("expected permission failure");}
        catch(GithubProjectClient.ApiException error){assertEquals(403,error.status);assertTrue(error.getMessage().contains("permissions"));assertTrue(error.getMessage().contains("code resource_not_accessible"));assertTrue(error.getMessage().contains("endpoint requires repository_creation=write"));assertTrue(error.getMessage().contains("installation verified; Repository creation: write; Contents: write"));assertFalse(error.getMessage().contains("test-token"));assertFalse(error.getMessage().contains("octocat/my-site"));}
        assertEquals(4,fake.calls.size());assertTrue(fake.calls.get(0).startsWith("GET "));assertTrue(fake.calls.get(1).startsWith("GET https://api.github.com/user/installations"));assertTrue(fake.calls.get(2).startsWith("GET https://api.github.com/repos/template-owner/site-starter"));assertTrue(fake.calls.get(3).startsWith("POST https://api.github.com/repos/template-owner/site-starter/generate"));
    }

    @Test public void doesNotPostWhenTheAppIsNotInstalledOnTheSignedInAccount()throws Exception{
        Fake fake=new Fake();fake.add(404,new JSONObject());fake.add(200,new JSONObject().put("total_count",0).put("installations",new JSONArray()));
        try{client(fake).createPrivate("test-token","octocat","my-site");fail("missing installation must stop before create");}
        catch(GithubProjectClient.ApiException error){assertEquals(403,error.status);assertTrue(error.getMessage().contains("no installation of this app"));assertFalse(error.getMessage().contains("test-token"));}
        assertEquals(2,fake.calls.size());assertFalse(fake.calls.toString().contains("POST "));
    }

    @Test public void installationPreflightIsReadOnlyAndReportsMissingInstallation()throws Exception{
        Fake fake=new Fake();fake.add(200,new JSONObject().put("total_count",0).put("installations",new JSONArray()));
        try{client(fake).checkCurrentInstallation("test-token","octocat",1);fail("missing installation must be reported");}
        catch(GithubProjectClient.ApiException error){assertEquals(403,error.status);assertTrue(error.getMessage().contains("no installation of this app"));assertFalse(error.getMessage().contains("test-token"));}
        assertEquals(1,fake.calls.size());assertTrue(fake.calls.get(0).startsWith("GET https://api.github.com/user/installations?per_page=100"));
        assertFalse(fake.calls.toString().contains("POST "));assertFalse(fake.calls.toString().contains("PUT "));
    }

    @Test public void installationPreflightReportsOnlyVerifiedAccountPermissions()throws Exception{
        Fake fake=new Fake();addCurrentInstallation(fake,"octocat",1,"write");
        assertEquals("installation verified; Repository creation: write; Contents: write",client(fake).checkCurrentInstallation("test-token","octocat",1));
        assertEquals(1,fake.calls.size());assertTrue(fake.calls.get(0).startsWith("GET https://api.github.com/user/installations"));
        assertFalse(fake.calls.toString().contains("POST "));assertFalse(fake.calls.toString().contains("PUT "));
    }

    @Test public void doesNotPostWhenInstallationLacksRepositoryCreationWrite()throws Exception{
        Fake fake=new Fake();fake.add(404,new JSONObject());addCurrentInstallation(fake,"octocat",1,"read");
        try{client(fake).createPrivate("test-token","octocat","my-site");fail("missing permission must stop before create");}
        catch(GithubProjectClient.ApiException error){assertEquals(403,error.status);assertTrue(error.getMessage().contains("lacks Repository creation: write"));}
        assertEquals(2,fake.calls.size());assertFalse(fake.calls.toString().contains("POST "));
    }

    @Test public void doesNotPostWhenInstallationLacksContentsWrite()throws Exception{
        Fake fake=new Fake();fake.add(404,new JSONObject());
        fake.add(200,new JSONObject().put("total_count",1).put("installations",new JSONArray().put(new JSONObject()
                .put("app_id",TEST_APP_ID).put("account",new JSONObject().put("login","octocat").put("id",1))
                .put("permissions",new JSONObject().put("repository_creation","write").put("contents","read")))));
        try{client(fake).createPrivate("test-token","octocat","my-site");fail("missing Contents write must stop before create");}
        catch(GithubProjectClient.ApiException error){assertEquals(403,error.status);assertTrue(error.getMessage().contains("lacks Contents: write"));}
        assertEquals(2,fake.calls.size());assertFalse(fake.calls.toString().contains("POST "));
    }

    @Test public void sanitizesAcceptedPermissionHeaderAndProviderMessage(){
        assertEquals("contents=read; repository_creation=write",GithubProjectClient.sanitizeAcceptedPermissions("contents=read; repository_creation=write"));
        assertEquals("",GithubProjectClient.sanitizeAcceptedPermissions("repository_creation=write\\nAuthorization: Bearer test-token"));
        assertEquals("resource_not_accessible",GithubProjectClient.safeErrorCode("Resource not accessible by integration"));
        assertEquals("",GithubProjectClient.safeErrorCode("Resource not accessible by integration for octocat/my-site token=test-token"));
    }

    @Test public void httpTransportCapturesOnlyTheAcceptedPermissionsHeader()throws Exception{
        try(ServerSocket server=new ServerSocket(0)){
            Thread responder=new Thread(()->{try(Socket socket=server.accept()){
                java.io.BufferedReader input=new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(),StandardCharsets.US_ASCII));String line;while((line=input.readLine())!=null&&!line.isEmpty()){}
                byte[] body="{\"message\":\"Resource not accessible by integration\"}".getBytes(StandardCharsets.UTF_8);
                socket.getOutputStream().write(("HTTP/1.1 403 Forbidden\r\nX-Accepted-GitHub-Permissions: repository_creation=write\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));socket.getOutputStream().write(body);socket.getOutputStream().flush();
            }catch(Exception error){throw new RuntimeException(error);}});responder.start();
            GithubProjectClient.Response response=new GithubProjectClient.HttpTransport().execute("GET","http://127.0.0.1:"+server.getLocalPort()+"/","test-token",null);
            assertEquals(403,response.status);assertEquals("repository_creation=write",response.acceptedPermissions);assertEquals("Resource not accessible by integration",response.json.getString("message"));
            responder.join(2000);assertFalse(responder.isAlive());
        }
    }

    @Test public void existingExactNameStopsBeforeAnyCreateOrContentWrite()throws Exception{
        Fake fake=new Fake();fake.add(200,repository("octocat","atimode",true,456));
        try{client(fake).createPrivate("test-token","octocat","atimode");fail("existing repository must not be adopted");}
        catch(GithubProjectClient.ApiException error){assertEquals(409,error.status);assertTrue(error.getMessage().contains("already exists"));}
        assertEquals(1,fake.calls.size());assertTrue(fake.calls.get(0).startsWith("GET https://api.github.com/repos/octocat/atimode"));
    }

    @Test public void rejectsUntrustedRepositoryNamesBeforeCallingGithub()throws Exception{
        Fake fake=new Fake();
        for(String name:new String[]{"../other","Owner/repo","repo?x","UPPER"})try{client(fake).createPrivate("test-token","octocat",name);fail("expected invalid name rejection");}catch(IllegalArgumentException expected){}
        assertTrue(fake.calls.isEmpty());
    }

    @Test public void refusesWrongOwnerOrPublicRepositoryBeforeSavingBinding()throws Exception{
        for(JSONObject bad:new JSONObject[]{repository("someone-else","my-site",true,123),repository("octocat","my-site",false,123)}){
            Fake fake=new Fake();fake.add(404,new JSONObject());addCurrentInstallation(fake,"octocat",1,"write");addApprovedTemplate(fake);fake.add(201,bad);
            try{client(fake).createPrivate("test-token","octocat","my-site");fail("expected binding rejection");}
            catch(GithubProjectClient.ApiException expected){assertEquals(403,expected.status);}
            assertEquals(4,fake.calls.size());
        }
    }

    @Test public void rejectsRepositoryWhoseImmutableOwnerIdDoesNotMatchVerifiedAccount()throws Exception{
        Fake fake=new Fake();fake.add(404,new JSONObject());addCurrentInstallation(fake,"octocat",1,"write");addApprovedTemplate(fake);fake.add(201,repository("octocat","my-site",true,123).put("owner",new JSONObject().put("login","octocat").put("id",99)));
        try{client(fake).createPrivate("test-token","octocat","my-site",1);fail("expected immutable owner identity rejection");}
        catch(GithubProjectClient.ApiException expected){assertEquals(403,expected.status);}
        assertEquals(4,fake.calls.size());
    }

    @Test public void creationIntentIsPersistedAfterPreflightAndBeforeCreateRequest()throws Exception{
        Fake fake=new Fake();fake.add(404,new JSONObject());addCurrentInstallation(fake,"octocat",1,"write");addApprovedTemplate(fake);fake.add(403,new JSONObject().put("message","missing permission"));int[] persisted={0};
        try{client(fake).createPrivate("test-token","octocat","my-site",1,()->persisted[0]++);fail("expected permission denial");}
        catch(GithubProjectClient.ApiException expected){assertEquals(403,expected.status);}
        assertEquals(1,persisted[0]);assertEquals(4,fake.calls.size());
    }

    @Test public void refusesToCreateWhenTheReviewedTemplateIdentityChanged()throws Exception{
        Fake fake=new Fake();fake.add(404,new JSONObject());addCurrentInstallation(fake,"octocat",1,"write");
        fake.add(200,new JSONObject().put("id",999).put("name","site-starter").put("private",false).put("is_template",true).put("owner",new JSONObject().put("login","template-owner")));
        int[] persisted={0};
        try{client(fake).createPrivate("test-token","octocat","my-site",1,()->persisted[0]++);fail("changed template identity must stop before create");}
        catch(GithubProjectClient.ApiException error){assertEquals(409,error.status);assertTrue(error.getMessage().contains("did not match the reviewed template"));}
        assertEquals(0,persisted[0]);assertEquals(3,fake.calls.size());assertFalse(fake.calls.toString().contains("POST "));
    }

    @Test public void refusesCreationWhenApprovedTemplateIsNotConfigured()throws Exception{
        Fake fake=new Fake();fake.add(404,new JSONObject());addCurrentInstallation(fake,"octocat",1,"write");int[] persisted={0};
        GithubProjectClient unconfigured=new GithubProjectClient(fake,TEST_APP_ID,"","",0);
        try{unconfigured.createPrivate("test-token","octocat","my-site",1,()->persisted[0]++);fail("missing template configuration must stop before create");}
        catch(GithubProjectClient.ApiException error){assertEquals(0,error.status);assertTrue(error.getMessage().contains("not configured"));}
        assertEquals(0,persisted[0]);assertEquals(2,fake.calls.size());assertFalse(fake.calls.toString().contains("POST "));
    }

    @Test public void missingScaffoldContentNeverTriggersAnAppWrite()throws Exception{
        Fake fake=new Fake();fake.add(404,new JSONObject());addCurrentInstallation(fake,"octocat",1,"write");addApprovedTemplate(fake);fake.add(201,repository("octocat","my-site",true,123));fake.add(200,repository("octocat","my-site",true,123));fake.add(200,repository("octocat","my-site",true,123));fake.add(404,new JSONObject());
        GithubProjectClient client=client(fake);GithubProjectClient.Binding binding=client.createPrivate("test-token","octocat","my-site");
        assertNull(client.readContentVerified(binding,"test-token","octocat",1));
        assertEquals(7,fake.calls.size());assertFalse(fake.calls.toString().contains("PUT "));
    }

    @Test public void staleShaReturnsRemoteRevisionWithoutWriting()throws Exception{
        Fake fake=new Fake();fake.add(200,repository("octocat","my-site",true,123));fake.add(200,contentFile(emptyContent(),NEXT));
        GithubProjectClient client=client(fake);
        try{client.saveContentVerified(new GithubProjectClient.Binding(123,"octocat","my-site","main"),"test-token","octocat",SHA,emptyContent());fail("expected stale revision conflict");}
        catch(GithubProjectClient.ConflictException conflict){assertEquals(NEXT,conflict.remote.sha);}
        assertEquals(2,fake.calls.size());assertTrue(fake.calls.get(1).contains("/contents/content/content.json"));
    }

    @Test public void githubRaceAfterShaReadReturnsLatestVersionAndNeverRetriesBlindly()throws Exception{
        Fake fake=new Fake();fake.add(200,repository("octocat","my-site",true,123));fake.add(200,contentFile(emptyContent(),SHA));
        fake.add(409,new JSONObject().put("message","sha does not match"));fake.add(200,contentFile(emptyContent(),NEXT));
        try{client(fake).saveContentVerified(new GithubProjectClient.Binding(123,"octocat","my-site","main"),"test-token","octocat",SHA,emptyContent());fail("expected raced update conflict");}
        catch(GithubProjectClient.ConflictException conflict){assertEquals(NEXT,conflict.remote.sha);}
        assertEquals(4,fake.calls.size());assertTrue(fake.calls.get(2).startsWith("PUT "));assertTrue(fake.calls.get(3).startsWith("GET "));
    }

    @Test public void rejectsWrongPinnedIdAndUnsafeContentPaths()throws Exception{
        Fake fake=new Fake();fake.add(200,repository("octocat","my-site",true,999));
        try{client(fake).readContentVerified(new GithubProjectClient.Binding(123,"octocat","my-site","main"),"test-token","octocat");fail("expected immutable ID mismatch");}
        catch(GithubProjectClient.ApiException expected){assertEquals(403,expected.status);}
        JSONObject unsafe=emptyContent();unsafe.put("pages",new JSONArray().put(new JSONObject().put("slug","%2e%2e/admin")));
        try{GithubProjectClient.validateContent(unsafe);fail("expected path rejection");}catch(IllegalArgumentException expected){assertNotNull(expected.getMessage());}
        JSONObject badMedia=emptyContent();badMedia.put("pages",new JSONArray().put(new JSONObject().put("id","f284b9b2-455f-4d06-a936-8ad1f5f8a0b1").put("slug","about").put("title","About").put("published",false).put("description",new JSONObject().put("source","manual").put("value","")).put("blocks",new JSONArray()).put("src","/media/../../secret.png")));
        try{GithubProjectClient.validateContent(badMedia);fail("expected media path rejection");}catch(IllegalArgumentException expected){assertNotNull(expected.getMessage());}
    }

    @Test public void refusesToWriteWhenThePinnedDefaultBranchChanges()throws Exception{
        Fake fake=new Fake();fake.add(200,repository("octocat","my-site",true,123).put("default_branch","new-main"));
        try{client(fake).verify(new GithubProjectClient.Binding(123,"octocat","my-site","main"),"test-token","octocat");fail("expected branch mismatch");}
        catch(GithubProjectClient.ApiException error){assertEquals(409,error.status);}
        assertEquals(1,fake.calls.size());
    }
}
