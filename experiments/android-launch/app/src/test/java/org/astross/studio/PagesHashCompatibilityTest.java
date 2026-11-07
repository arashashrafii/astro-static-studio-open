package org.astross.studio;

import org.apache.commons.codec.digest.Blake3;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.assertEquals;

public final class PagesHashCompatibilityTest {
    @Test public void matchesOfficialBlake3EmptyInputVector() {
        assertEquals("af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262", hex(Blake3.hash(new byte[0])));
    }

    @Test public void matchesPagesHashesProducedByTheTypeScriptPublishingAdapter()throws Exception{
        byte[] raw;
        try(InputStream input=getClass().getClassLoader().getResourceAsStream("pages-hash-vectors.json")){
            if(input==null)throw new AssertionError("Shared Pages hash vectors were not packaged for Android tests.");
            ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] chunk=new byte[4096];int count;while((count=input.read(chunk))!=-1)output.write(chunk,0,count);raw=output.toByteArray();
        }
        JSONArray vectors=new JSONArray(new String(raw,StandardCharsets.UTF_8));
        for(int i=0;i<vectors.length();i++){
            JSONObject vector=vectors.getJSONObject(i);byte[] content=vector.getString("contentUtf8").getBytes(StandardCharsets.UTF_8);
            assertEquals(vector.getString("relativePath"),vector.getString("pagesHash"),CloudflareArtifactManifest.pagesHash(content,vector.getString("relativePath")));
        }
    }

    private static String hex(byte[] bytes){StringBuilder value=new StringBuilder();for(byte item:bytes)value.append(String.format(java.util.Locale.ROOT,"%02x",item&255));return value.toString();}
}
