package org.astross.studio;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;

/** Downloads only the pinned Actions artifact; bearer auth is never sent to signed storage URLs. */
final class GithubArtifactDownloader {
    static final int MAX_COMPRESSED_BYTES=16*1024*1024;
    static final int MAX_REDIRECTS=4;
    interface Transport { Response get(String url,String bearerToken,int maxBytes)throws Exception; }
    static final class Response { final int status; final String location; final byte[] body; Response(int status,String location,byte[] body){this.status=status;this.location=location;this.body=body;} }

    private GithubArtifactDownloader(){}

    static GithubArtifactArchive.VerifiedSite download(GithubActionsBuildClient.Result artifact,GithubProjectClient.Binding repository,String token,Transport transport)throws Exception{
        if(artifact==null||artifact.state!=GithubActionsBuildClient.State.READY||repository==null||artifact.artifactId<=0||artifact.runId<=0||artifact.runAttempt<=0||
                artifact.repositoryId!=repository.id||artifact.workflowId<=0||repository.id<=0||repository.ownerId<=0||repository.owner==null||!repository.owner.matches("[A-Za-z0-9-]{1,39}")||artifact.revision==null||!artifact.revision.matches("[0-9a-f]{40}")||
                artifact.workflowRevision==null||!artifact.workflowRevision.matches("[0-9a-f]{40}")||
                !artifact.name.equals(GithubActionsBuildClient.artifactName(artifact.revision,artifact.runId,artifact.runAttempt))||
                !artifact.digest.matches("sha256:[0-9a-f]{64}")||token==null||token.isEmpty())
            throw new IllegalArgumentException("A verified artifact and its pinned repository authorization are required.");
        GithubProjectClient.validateRepositoryName(repository.name);
        String url="https://api.github.com/repos/"+repository.owner+"/"+repository.name+"/actions/artifacts/"+artifact.artifactId+"/zip";
        byte[] zip=null;
        for(int redirects=0;redirects<=MAX_REDIRECTS;redirects++){
            Response response=transport.get(url,redirects==0?token:null,MAX_COMPRESSED_BYTES);
            if(response.status==200){zip=response.body;if(zip==null||zip.length>MAX_COMPRESSED_BYTES)throw new SecurityException("The GitHub artifact exceeds the compressed size limit.");break;}
            if(!isRedirect(response.status)||response.location==null||response.location.isEmpty())throw new GithubProjectClient.ApiException(response.status,"GitHub could not provide the verified build artifact.");
            if(redirects==MAX_REDIRECTS)throw new SecurityException("The artifact download redirected too many times.");
            url=redirectUrl(url,response.location);
        }
        if(zip==null||!GithubActionsBuildClient.verifyDownloadedZip(artifact,zip))throw new SecurityException("The downloaded artifact digest did not match GitHub's artifact metadata.");
        GithubArtifactArchive.VerifiedSite site=GithubArtifactArchive.validate(zip);
        CloudflareArtifactManifest manifest=CloudflareArtifactManifest.from(site);
        if(!artifact.revision.equals(manifest.sourceRevision)||!artifact.workflowRevision.equals(manifest.workflowRevision))
            throw new SecurityException("The artifact source or workflow revision does not match the verified GitHub run.");
        return site.withVerifiedRevisions(manifest.sourceRevision,manifest.workflowRevision);
    }

    private static boolean isRedirect(int status){return status==301||status==302||status==303||status==307||status==308;}
    private static String redirectUrl(String current,String location)throws Exception{
        URI resolved=new URI(current).resolve(location);
        if(!"https".equalsIgnoreCase(resolved.getScheme())||resolved.getHost()==null||resolved.getUserInfo()!=null||resolved.getFragment()!=null)
            throw new SecurityException("The signed artifact download must use a safe HTTPS URL.");
        return resolved.toASCIIString();
    }

    static final class HttpTransport implements Transport {
        @Override public Response get(String address,String bearerToken,int maxBytes)throws Exception{
            URI uri=new URI(address);
            if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getFragment()!=null)throw new SecurityException("Artifact download URL is not safe HTTPS.");
            HttpURLConnection connection=(HttpURLConnection)new URL(address).openConnection();connection.setRequestMethod("GET");connection.setConnectTimeout(12000);connection.setReadTimeout(30000);connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept","application/vnd.github+json, application/octet-stream");
            if(bearerToken!=null&&!bearerToken.isEmpty())connection.setRequestProperty("Authorization","Bearer "+bearerToken);
            try{
                int status=connection.getResponseCode();String location=connection.getHeaderField("Location");byte[] body=new byte[0];
                if(status==200){long declared=connection.getContentLengthLong();if(declared>maxBytes)throw new SecurityException("The GitHub artifact exceeds the compressed size limit.");
                    InputStream input=connection.getInputStream();try{ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] chunk=new byte[8192];int count;while((count=input.read(chunk))!=-1){if(output.size()+count>maxBytes)throw new SecurityException("The GitHub artifact exceeds the compressed size limit.");output.write(chunk,0,count);}body=output.toByteArray();}finally{input.close();}}
                else {InputStream error=connection.getErrorStream();if(error!=null)error.close();}
                return new Response(status,location,body);
            }finally{connection.disconnect();}
        }
    }
}
