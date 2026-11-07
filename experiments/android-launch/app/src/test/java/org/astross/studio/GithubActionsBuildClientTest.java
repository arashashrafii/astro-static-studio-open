package org.astross.studio;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.ArrayDeque;
import java.util.Queue;
import static org.junit.Assert.*;

public final class GithubActionsBuildClientTest {
    private static final String SHA="0123456789abcdef0123456789abcdef01234567",WORKFLOW_SHA="fedcba9876543210fedcba9876543210fedcba98";
    private static final long NOW=1794045600000L;
    private static final long WORKFLOW=42,RUN=987,ARTIFACT=1234;
    private static final class Fake implements GithubActionsBuildClient.Transport {
        final Queue<GithubActionsBuildClient.Response> responses=new ArrayDeque<>();final java.util.List<String> calls=new java.util.ArrayList<>();
        void add(int status,JSONObject json){responses.add(new GithubActionsBuildClient.Response(status,json));}
        @Override public GithubActionsBuildClient.Response execute(String method,String url,String token,JSONObject body){assertEquals("test-token",token);calls.add(method+" "+url+(body==null?"":" "+body));return responses.remove();}
    }
    private final GithubProjectClient.Binding repo=new GithubProjectClient.Binding(99,1,"octocat","private-site","main");
    private JSONObject workflow()throws Exception{return new JSONObject().put("id",WORKFLOW).put("path",GithubActionsBuildClient.WORKFLOW_PATH).put("state","active");}
    private JSONObject run(String status,String conclusion,int attempt)throws Exception{return new JSONObject().put("id",RUN).put("workflow_id",WORKFLOW).put("path",GithubActionsBuildClient.WORKFLOW_PATH).put("head_sha",WORKFLOW_SHA)
            .put("repository",new JSONObject().put("id",repo.id)).put("event","workflow_dispatch").put("head_branch","main")
            .put("actor",new JSONObject().put("login","octocat")).put("created_at","2026-11-07T10:01:00Z")
            .put("status",status).put("conclusion",conclusion).put("run_attempt",attempt);}
    private JSONObject artifact(String name,boolean expired,String expires,String digest)throws Exception{return new JSONObject().put("id",ARTIFACT).put("name",name).put("expired",expired).put("expires_at",expires).put("digest",digest);}
    private JSONObject runList(JSONObject... runs)throws Exception{return new JSONObject().put("workflow_runs",new JSONArray(runs));}
    private JSONObject artifacts(JSONObject... values)throws Exception{return new JSONObject().put("artifacts",new JSONArray(values));}
    private GithubActionsBuildClient.Dispatch dispatch(){return new GithubActionsBuildClient.Dispatch(SHA,NOW,repo.id,repo.owner,repo.branch,WORKFLOW,GithubActionsBuildClient.WORKFLOW_PATH);}

    @Test public void dispatchesOnlyVerifiedWorkflowWithFullPinnedRevision()throws Exception{
        Fake fake=new Fake();fake.add(200,workflow());fake.add(204,new JSONObject());
        GithubActionsBuildClient.Dispatch result=new GithubActionsBuildClient(fake).dispatch("test-token",repo,WORKFLOW,GithubActionsBuildClient.WORKFLOW_PATH,SHA,NOW);
        assertEquals(SHA,result.revision);assertEquals(2,fake.calls.size());assertTrue(fake.calls.get(0).startsWith("GET https://api.github.com/repos/octocat/private-site/actions/workflows/42"));
        assertTrue(fake.calls.get(1).contains("/dispatches"));assertTrue(fake.calls.get(1).contains("\"ref\":\"main\""));assertTrue(fake.calls.get(1).contains("\"revision\":\""+SHA+"\""));
    }

    @Test public void refusesWrongWorkflowPathBeforeDispatch()throws Exception{
        Fake fake=new Fake();fake.add(200,workflow().put("path",".github/workflows/other.yml"));
        try{new GithubActionsBuildClient(fake).dispatch("test-token",repo,WORKFLOW,GithubActionsBuildClient.WORKFLOW_PATH,SHA,NOW);fail("expected workflow mismatch");}
        catch(GithubProjectClient.ApiException expected){}
        assertEquals(1,fake.calls.size());assertTrue(fake.calls.get(0).startsWith("GET "));
    }

    @Test public void refusesUnpinnedOrUnsupportedDispatchInputsBeforeNetwork()throws Exception{
        Fake fake=new Fake();GithubActionsBuildClient client=new GithubActionsBuildClient(fake);
        for(String revision:new String[]{"",SHA.toUpperCase(),"main","0123"})try{client.dispatch("test-token",repo,WORKFLOW,GithubActionsBuildClient.WORKFLOW_PATH,revision,NOW);fail("expected invalid revision");}catch(IllegalArgumentException expected){}
        assertTrue(fake.calls.isEmpty());
    }

    @Test public void reportsPendingRunWithoutAcceptingArtifactEarly()throws Exception{
        Fake fake=new Fake();fake.add(200,runList(run("in_progress","",1)));fake.add(200,artifacts());
        GithubActionsBuildClient.Result result=new GithubActionsBuildClient(fake).poll("test-token",repo,"octocat",WORKFLOW,GithubActionsBuildClient.WORKFLOW_PATH,dispatch(),NOW+1000);
        assertEquals(GithubActionsBuildClient.State.PENDING,result.state);
    }

    @Test public void acceptsOnlySuccessfulRunAndExactRevisionRunAttemptArtifact()throws Exception{
        Fake fake=new Fake();fake.add(200,runList(run("completed","success",2)));
        String name=GithubActionsBuildClient.artifactName(SHA,RUN,2);String digest="sha256:"+repeat("a",64);
        fake.add(200,artifacts(artifact(name,false,"2026-11-08T09:00:00Z",digest)));
        GithubActionsBuildClient.Result result=new GithubActionsBuildClient(fake).poll("test-token",repo,"octocat",WORKFLOW,GithubActionsBuildClient.WORKFLOW_PATH,dispatch(),NOW+1000);
        assertEquals(GithubActionsBuildClient.State.READY,result.state);assertEquals(SHA,result.revision);assertEquals(WORKFLOW_SHA,result.workflowRevision);assertEquals(name,result.name);assertEquals(digest,result.digest);assertEquals(RUN,result.runId);assertEquals(2,result.runAttempt);assertEquals(ARTIFACT,result.artifactId);
        assertEquals(2,fake.calls.size());assertTrue(fake.calls.get(1).contains("/actions/runs/"+RUN+"/artifacts"));
    }

    @Test public void downloadedZipMustMatchGithubSha256Digest()throws Exception{
        byte[] zip={80,75,3,4,1,2,3};java.security.MessageDigest sha=java.security.MessageDigest.getInstance("SHA-256");
        String digest="sha256:"+hex(sha.digest(zip));
        GithubActionsBuildClient.Result result=GithubActionsBuildClient.Result.ready(SHA,WORKFLOW_SHA,"artifact",digest,RUN,1,ARTIFACT,repo.id,WORKFLOW);
        assertTrue(GithubActionsBuildClient.verifyDownloadedZip(result,zip));assertFalse(GithubActionsBuildClient.verifyDownloadedZip(result,new byte[]{9}));
        assertFalse(GithubActionsBuildClient.verifyDownloadedZip(GithubActionsBuildClient.Result.pending(SHA),zip));
    }

    @Test public void rejectsMismatchedArtifactRevisionAttemptExpiredArtifactAndBadDigest()throws Exception{
        String validName=GithubActionsBuildClient.artifactName(SHA,RUN,1),goodDigest="sha256:"+repeat("b",64);
        for(JSONObject bad:new JSONObject[]{artifact(GithubActionsBuildClient.artifactName(repeat("f",40),RUN,1),false,"2026-11-08T09:00:00Z",goodDigest),
                artifact(validName,true,"2026-11-08T09:00:00Z",goodDigest),artifact(validName,false,"2026-11-06T09:00:00Z",goodDigest),artifact(validName,false,"2026-11-08T09:00:00Z","sha1:"+repeat("b",40))}){
            Fake fake=new Fake();fake.add(200,runList(run("completed","success",1)));fake.add(200,artifacts(bad));
            GithubActionsBuildClient.Result result=new GithubActionsBuildClient(fake).poll("test-token",repo,"octocat",WORKFLOW,GithubActionsBuildClient.WORKFLOW_PATH,dispatch(),NOW+1000);
            assertEquals(GithubActionsBuildClient.State.FAILED,result.state);
        }
    }

    @Test public void rejectsWrongRepositoryActorWorkflowEventOrBranch()throws Exception{
        JSONObject badRun=run("completed","success",1).put("repository",new JSONObject().put("id",100));
        Fake fake=new Fake();fake.add(200,runList(badRun,run("completed","success",1).put("actor",new JSONObject().put("login","other")),
                run("completed","success",1).put("event","push"),run("completed","success",1).put("head_branch","release")));
        GithubActionsBuildClient.Result result=new GithubActionsBuildClient(fake).poll("test-token",repo,"octocat",WORKFLOW,GithubActionsBuildClient.WORKFLOW_PATH,dispatch(),NOW+1000);
        assertEquals(GithubActionsBuildClient.State.PENDING,result.state);assertEquals(1,fake.calls.size());
    }

    @Test public void ambiguousMatchingRunsFailClosed()throws Exception{
        JSONObject second=run("completed","success",1).put("id",RUN+1);
        Fake fake=new Fake();fake.add(200,runList(run("completed","success",1),second));
        fake.add(200,artifacts());fake.add(200,artifacts());
        GithubActionsBuildClient.Result result=new GithubActionsBuildClient(fake).poll("test-token",repo,"octocat",WORKFLOW,GithubActionsBuildClient.WORKFLOW_PATH,dispatch(),NOW+1000);
        assertEquals(GithubActionsBuildClient.State.AMBIGUOUS,result.state);
    }

    private static String repeat(String s,int count){StringBuilder value=new StringBuilder();for(int i=0;i<count;i++)value.append(s);return value.toString();}
    private static String hex(byte[] bytes){StringBuilder value=new StringBuilder();for(byte b:bytes)value.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return value.toString();}
}
