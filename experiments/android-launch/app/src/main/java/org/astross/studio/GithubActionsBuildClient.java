package org.astross.studio;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.security.MessageDigest;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Narrow Actions API boundary for dispatching and verifying one revision-pinned site build. */
final class GithubActionsBuildClient {
    static final String WORKFLOW_PATH=".github/workflows/studio-static-build.yml";
    interface Transport { Response execute(String method,String url,String token,JSONObject body)throws Exception; }
    static final class Response { final int status; final JSONObject json; Response(int status,JSONObject json){this.status=status;this.json=json;} }
    static final class Dispatch {
        final String revision,owner,branch,path; final long requestedAtMillis,repositoryId,workflowId;
        Dispatch(String revision,long requestedAtMillis,long repositoryId,String owner,String branch,long workflowId,String path){this.revision=revision;this.requestedAtMillis=requestedAtMillis;this.repositoryId=repositoryId;this.owner=owner;this.branch=branch;this.workflowId=workflowId;this.path=path;}
    }
    enum State { PENDING, READY, FAILED, AMBIGUOUS }
    static final class Result {
        final State state; final String message,revision,workflowRevision,digest,name; final long runId,artifactId,repositoryId,workflowId; final int runAttempt;
        private Result(State state,String message,String revision,String workflowRevision,String name,String digest,long runId,int runAttempt,long artifactId,long repositoryId,long workflowId){this.state=state;this.message=message;this.revision=revision;this.workflowRevision=workflowRevision;this.name=name;this.digest=digest;this.runId=runId;this.runAttempt=runAttempt;this.artifactId=artifactId;this.repositoryId=repositoryId;this.workflowId=workflowId;}
        static Result pending(String revision){return new Result(State.PENDING,"GitHub Actions build is still running.",revision,"","","",0,0,0,0,0);}
        static Result failed(String revision,String message){return new Result(State.FAILED,message,revision,"","","",0,0,0,0,0);}
        static Result ambiguous(String revision){return new Result(State.AMBIGUOUS,"More than one matching workflow run was found. No artifact was accepted.",revision,"","","",0,0,0,0,0);}
        static Result ready(String revision,String workflowRevision,String name,String digest,long runId,int attempt,long artifactId,long repositoryId,long workflowId){return new Result(State.READY,"Verified workflow artifact metadata.",revision,workflowRevision,name,digest,runId,attempt,artifactId,repositoryId,workflowId);}
    }

    private final Transport transport;
    GithubActionsBuildClient(Transport transport){this.transport=transport;}

    Dispatch dispatch(String token,GithubProjectClient.Binding repository,long workflowId,String workflowPath,String revision,long nowMillis)throws Exception{
        validate(repository,workflowId,workflowPath,revision);
        Response workflow=request("GET",repoPath(repository)+"/actions/workflows/"+workflowId,token,null);
        if(workflow.status!=200||workflow.json.optLong("id",0)!=workflowId||!WORKFLOW_PATH.equals(workflow.json.optString("path"))||!"active".equals(workflow.json.optString("state")))
            throw new GithubProjectClient.ApiException(workflow.status,"The configured static build workflow could not be verified.");
        JSONObject body=new JSONObject().put("ref",repository.branch).put("inputs",new JSONObject().put("revision",revision));
        Response sent=request("POST",repoPath(repository)+"/actions/workflows/"+workflowId+"/dispatches",token,body);
        if(sent.status!=204)throw new GithubProjectClient.ApiException(sent.status,"GitHub did not accept the pinned static build request.");
        return new Dispatch(revision,nowMillis,repository.id,repository.owner,repository.branch,workflowId,workflowPath);
    }

    /** Finds only runs attributable to this dispatch window and accepts exactly one matching artifact. */
    Result poll(String token,GithubProjectClient.Binding repository,String accountLogin,long workflowId,String workflowPath,Dispatch dispatch,long nowMillis)throws Exception{
        validate(repository,workflowId,workflowPath,dispatch==null?null:dispatch.revision);
        if(dispatch.repositoryId!=repository.id||dispatch.workflowId!=workflowId||!dispatch.owner.equalsIgnoreCase(repository.owner)||!dispatch.branch.equals(repository.branch)||!dispatch.path.equals(workflowPath))
            throw new IllegalArgumentException("The build status request does not match the dispatched repository and workflow.");
        if(accountLogin==null||!repository.owner.equalsIgnoreCase(accountLogin))throw new IllegalArgumentException("Verified repository owner is required.");
        String url=repoPath(repository)+"/actions/workflows/"+workflowId+"/runs?event=workflow_dispatch&branch="+encode(repository.branch)+"&per_page=100";
        Response response=request("GET",url,token,null);
        if(response.status!=200)throw new GithubProjectClient.ApiException(response.status,"Could not check the GitHub Actions build status.");
        JSONArray runs=response.json.optJSONArray("workflow_runs");if(runs==null)return Result.failed(dispatch.revision,"GitHub returned an invalid workflow run list.");
        JSONArray candidates=new JSONArray();
        for(int i=0;i<runs.length();i++){
            JSONObject run=runs.optJSONObject(i);if(run==null)continue;
            JSONObject runRepository=run.optJSONObject("repository");
            if(run.optLong("workflow_id",0)!=workflowId||runRepository==null||runRepository.optLong("id",0)!=repository.id||!WORKFLOW_PATH.equals(run.optString("path"))||
                    !"workflow_dispatch".equals(run.optString("event"))||!repository.branch.equals(run.optString("head_branch"))||
                    !accountLogin.equalsIgnoreCase(run.optJSONObject("actor")==null?"":run.optJSONObject("actor").optString("login")))continue;
            long created=parseTime(run.optString("created_at",""));
            if(created>=dispatch.requestedAtMillis-15_000&&created<=nowMillis+60_000&&run.optLong("id",0)>0&&run.optInt("run_attempt",0)>0)candidates.put(run);
        }
        if(candidates.length()==0)return Result.pending(dispatch.revision);
        JSONArray matched=new JSONArray();
        for(int i=0;i<candidates.length();i++){
            JSONObject run=candidates.getJSONObject(i);long runId=run.getLong("id");int attempt=run.getInt("run_attempt");
            Response artifacts=request("GET",repoPath(repository)+"/actions/runs/"+runId+"/artifacts?per_page=100",token,null);
            if(artifacts.status!=200)throw new GithubProjectClient.ApiException(artifacts.status,"Could not verify the GitHub build artifact metadata.");
            JSONArray values=artifacts.json.optJSONArray("artifacts");if(values==null)throw new GithubProjectClient.ApiException(422,"GitHub returned invalid artifact metadata.");
            String expected=artifactName(dispatch.revision,runId,attempt);
            for(int j=0;j<values.length();j++){JSONObject artifact=values.optJSONObject(j);if(artifact!=null&&expected.equals(artifact.optString("name")))matched.put(new JSONObject().put("run",run).put("artifact",artifact));}
        }
        if(matched.length()>1)return Result.ambiguous(dispatch.revision);
        if(matched.length()==0){if(candidates.length()>1)return Result.ambiguous(dispatch.revision);JSONObject only=candidates.getJSONObject(0);
            if("queued".equals(only.optString("status"))||"in_progress".equals(only.optString("status")))return Result.pending(dispatch.revision);
            return Result.failed(dispatch.revision,"The workflow completed without its expected revision-pinned artifact.");}
        JSONObject pair=matched.getJSONObject(0),run=pair.getJSONObject("run"),artifact=pair.getJSONObject("artifact");
        if(!"completed".equals(run.optString("status")))return Result.pending(dispatch.revision);
        if(!"success".equals(run.optString("conclusion")))return Result.failed(dispatch.revision,"The static site build did not complete successfully.");
        String workflowRevision=run.optString("head_sha","");
        if(!workflowRevision.matches("[0-9a-f]{40}"))return Result.failed(dispatch.revision,"GitHub returned an invalid workflow/ref revision.");
        long runId=run.getLong("id");int attempt=run.getInt("run_attempt");String name=artifactName(dispatch.revision,runId,attempt);
        if(artifact.optLong("id",0)<=0||artifact.optBoolean("expired",true)||parseTime(artifact.optString("expires_at",""))<=nowMillis)
            return Result.failed(dispatch.revision,"The expected build artifact is missing or expired.");
        String digest=artifact.optString("digest","");if(!digest.matches("sha256:[0-9a-f]{64}"))return Result.failed(dispatch.revision,"GitHub returned an invalid artifact digest.");
        return Result.ready(dispatch.revision,workflowRevision,name,digest,runId,attempt,artifact.getLong("id"),repository.id,workflowId);
    }

    static String artifactName(String revision,long runId,int attempt){return "studio-static-build-"+revision+"-"+runId+"-"+attempt;}
    static boolean verifyDownloadedZip(Result artifact,byte[] zip)throws Exception{
        if(artifact==null||artifact.state!=State.READY||zip==null)return false;
        byte[] expected=hex(artifact.digest.substring("sha256:".length()));
        return MessageDigest.isEqual(expected,MessageDigest.getInstance("SHA-256").digest(zip));
    }
    private static byte[] hex(String value){byte[] bytes=new byte[value.length()/2];for(int i=0;i<bytes.length;i++)bytes[i]=(byte)Integer.parseInt(value.substring(i*2,i*2+2),16);return bytes;}
    private Response request(String method,String url,String token,JSONObject body)throws Exception{return transport.execute(method,url,token,body);}
    private static String repoPath(GithubProjectClient.Binding repository){return "https://api.github.com/repos/"+repository.owner+"/"+repository.name;}
    private static String encode(String value)throws Exception{return URLEncoder.encode(value,"UTF-8");}
    private static void validate(GithubProjectClient.Binding repository,long workflowId,String path,String revision){
        if(repository==null||repository.id<=0||repository.ownerId<=0||repository.owner==null||!repository.owner.matches("[A-Za-z0-9-]{1,39}")||
                workflowId<=0||!WORKFLOW_PATH.equals(path)||revision==null||!revision.matches("[0-9a-f]{40}"))
            throw new IllegalArgumentException("A pinned repository, supported workflow, and full lowercase source revision are required.");
        GithubProjectClient.validateRepositoryName(repository.name);
        if(repository.branch==null||!repository.branch.matches("[A-Za-z0-9._/-]{1,200}")||repository.branch.startsWith("/")||repository.branch.contains(".."))
            throw new IllegalArgumentException("The pinned repository default branch is invalid.");
    }
    private static long parseTime(String value){try{SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));Date date=format.parse(value);return date==null?0:date.getTime();}catch(Exception error){return 0;}}
}
