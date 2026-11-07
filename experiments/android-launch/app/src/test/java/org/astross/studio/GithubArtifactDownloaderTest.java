package org.astross.studio;

import org.json.JSONObject;
import org.junit.Test;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import static org.junit.Assert.*;

public final class GithubArtifactDownloaderTest {
    private static final String SHA="0123456789abcdef0123456789abcdef01234567",WORKFLOW_SHA="fedcba9876543210fedcba9876543210fedcba98",OTHER_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",TOKEN="test-token";
    private static final class Fake implements GithubArtifactDownloader.Transport {
        final Queue<GithubArtifactDownloader.Response> responses=new ArrayDeque<>();final List<String> urls=new ArrayList<>(),tokens=new ArrayList<>();
        void add(int status,String location,byte[] body){responses.add(new GithubArtifactDownloader.Response(status,location,body));}
        @Override public GithubArtifactDownloader.Response get(String url,String token,int maxBytes){assertEquals(GithubArtifactDownloader.MAX_COMPRESSED_BYTES,maxBytes);urls.add(url);tokens.add(token);return responses.remove();}
    }
    private final GithubProjectClient.Binding repo=new GithubProjectClient.Binding(99,1,"octocat","private-site","main");
    private byte[] zip()throws Exception{return zip(SHA,WORKFLOW_SHA);}
    private byte[] zip(String sourceRevision,String workflowRevision)throws Exception{
        byte[] index="<h1>approved</h1>".getBytes(StandardCharsets.UTF_8),js="ok()".getBytes(StandardCharsets.UTF_8);
        JSONObject assets=new JSONObject().put("index.html",new JSONObject().put("pagesHash",CloudflareArtifactManifest.pagesHash(index,"index.html")).put("sha256",hex(MessageDigest.getInstance("SHA-256").digest(index))))
                .put("assets/app.js",new JSONObject().put("pagesHash",CloudflareArtifactManifest.pagesHash(js,"assets/app.js")).put("sha256",hex(MessageDigest.getInstance("SHA-256").digest(js))));
        byte[] manifest=new JSONObject().put("schemaVersion",2).put("assetIdentity",CloudflareArtifactManifest.ASSET_IDENTITY).put("sourceRevision",sourceRevision)
                .put("workflowRevision",workflowRevision).put("assets",assets).toString().getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(ZipOutputStream out=new ZipOutputStream(bytes)){
            out.putNextEntry(new ZipEntry("index.html"));out.write(index);out.closeEntry();out.putNextEntry(new ZipEntry("assets/app.js"));out.write(js);out.closeEntry();
            out.putNextEntry(new ZipEntry(CloudflareArtifactManifest.FILE_PATH));out.write(manifest);out.closeEntry();}return bytes.toByteArray();
    }
    private GithubActionsBuildClient.Result artifact(byte[] zip)throws Exception{return artifact(zip,SHA,WORKFLOW_SHA);}
    private GithubActionsBuildClient.Result artifact(byte[] zip,String sourceRevision,String workflowRevision)throws Exception{return GithubActionsBuildClient.Result.ready(sourceRevision,workflowRevision,
            GithubActionsBuildClient.artifactName(sourceRevision,987,1),"sha256:"+hex(MessageDigest.getInstance("SHA-256").digest(zip)),987,1,1234,repo.id,42);}

    @Test public void followsHttpsSignedRedirectWithoutForwardingBearerAndValidatesZip()throws Exception{
        byte[] zip=zip();Fake fake=new Fake();fake.add(302,"https://signed-storage.example/blob?signature=private",new byte[0]);fake.add(200,null,zip);
        GithubArtifactArchive.VerifiedSite site=GithubArtifactDownloader.download(artifact(zip),repo,TOKEN,fake);
        assertEquals("<h1>approved</h1>",new String(site.file("index.html"),StandardCharsets.UTF_8));assertEquals(SHA,site.sourceRevision);assertEquals(WORKFLOW_SHA,site.workflowRevision);assertEquals(2,fake.urls.size());
        assertTrue(fake.urls.get(0).contains("/actions/artifacts/1234/zip"));assertEquals(TOKEN,fake.tokens.get(0));assertNull(fake.tokens.get(1));
    }

    @Test public void rejectsHttpOrCredentialBearingRedirectBeforeFollowing()throws Exception{
        byte[] zip=zip();for(String location:new String[]{"http://storage.example/archive","https://user:pass@storage.example/archive","https://storage.example/archive#fragment"}){
            Fake fake=new Fake();fake.add(302,location,new byte[0]);try{GithubArtifactDownloader.download(artifact(zip),repo,TOKEN,fake);fail("unsafe redirect must fail");}catch(SecurityException expected){}
            assertEquals(1,fake.urls.size());assertEquals(TOKEN,fake.tokens.get(0));}
    }

    @Test public void rejectsDigestMismatchBeforeArchiveParsing()throws Exception{
        byte[] expected=zip(),wrong=zip();wrong[wrong.length-1]^=1;Fake fake=new Fake();fake.add(200,null,wrong);
        try{GithubArtifactDownloader.download(artifact(expected),repo,TOKEN,fake);fail("wrong digest must fail");}catch(SecurityException expectedError){assertTrue(expectedError.getMessage().contains("digest"));}
        assertEquals(1,fake.urls.size());
    }

    @Test public void rejectsManifestSourceAndWorkflowRevisionMismatches()throws Exception{
        byte[] sourceMismatch=zip(OTHER_SHA,WORKFLOW_SHA);Fake sourceFake=new Fake();sourceFake.add(200,null,sourceMismatch);
        try{GithubArtifactDownloader.download(artifact(sourceMismatch,SHA,WORKFLOW_SHA),repo,TOKEN,sourceFake);fail("wrong source revision accepted");}catch(SecurityException expected){}
        assertEquals(1,sourceFake.urls.size());
        byte[] workflowMismatch=zip(SHA,OTHER_SHA);Fake workflowFake=new Fake();workflowFake.add(200,null,workflowMismatch);
        try{GithubArtifactDownloader.download(artifact(workflowMismatch,SHA,WORKFLOW_SHA),repo,TOKEN,workflowFake);fail("wrong workflow revision accepted");}catch(SecurityException expected){}
        assertEquals(1,workflowFake.urls.size());
    }

    @Test public void rejectsWrongRepositoryAndOversizedResponseBeforeAcceptingArchive()throws Exception{
        byte[] archive=zip();GithubActionsBuildClient.Result valid=artifact(archive);GithubProjectClient.Binding other=new GithubProjectClient.Binding(100,1,"octocat","different","main");Fake unused=new Fake();
        try{GithubArtifactDownloader.download(valid,other,TOKEN,unused);fail("wrong repository binding must fail");}catch(IllegalArgumentException expected){}assertTrue(unused.urls.isEmpty());
        Fake tooLarge=new Fake();tooLarge.add(200,null,new byte[GithubArtifactDownloader.MAX_COMPRESSED_BYTES+1]);try{GithubArtifactDownloader.download(valid,repo,TOKEN,tooLarge);fail("oversized body must fail");}catch(SecurityException expected){}
    }

    @Test public void refusesTooManyRedirectsWithoutSendingTokenAgain()throws Exception{
        byte[] zip=zip();Fake fake=new Fake();for(int i=0;i<=GithubArtifactDownloader.MAX_REDIRECTS;i++)fake.add(302,"https://storage.example/step"+i,new byte[0]);
        try{GithubArtifactDownloader.download(artifact(zip),repo,TOKEN,fake);fail("redirect limit must fail");}catch(SecurityException expected){}
        assertEquals(GithubArtifactDownloader.MAX_REDIRECTS+1,fake.urls.size());for(int i=1;i<fake.tokens.size();i++)assertNull(fake.tokens.get(i));
    }

    private static String hex(byte[] bytes){StringBuilder value=new StringBuilder();for(byte item:bytes)value.append(String.format(java.util.Locale.ROOT,"%02x",item&255));return value.toString();}
}
