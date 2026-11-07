package org.astross.studio;

import org.json.JSONObject;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import static org.junit.Assert.*;

public final class CloudflareArtifactManifestTest {
    private static final String REVISION="0123456789abcdef0123456789abcdef01234567",WORKFLOW="fedcba9876543210fedcba9876543210fedcba98";
    private static final byte[] INDEX="<h1>site</h1>".getBytes(StandardCharsets.UTF_8),JS="ok()".getBytes(StandardCharsets.UTF_8);
    private static final String A=CloudflareArtifactManifest.pagesHash(INDEX,"index.html"),B=CloudflareArtifactManifest.pagesHash(JS,"assets/app.js");
    private GithubArtifactArchive.VerifiedSite site(String rawManifest,Map<String,byte[]> extra){Map<String,byte[]> files=new LinkedHashMap<>();files.put("index.html",INDEX.clone());files.put("assets/app.js",JS.clone());files.putAll(extra);files.put(CloudflareArtifactManifest.FILE_PATH,rawManifest.getBytes(StandardCharsets.UTF_8));return new GithubArtifactArchive.VerifiedSite(files);}
    private String manifest(Map<String,String> pagesHashes)throws Exception{return manifest(pagesHashes,REVISION,WORKFLOW);}
    private String manifest(Map<String,String> pagesHashes,String sourceRevision,String workflowRevision)throws Exception{
        JSONObject assets=new JSONObject();for(Map.Entry<String,String> item:pagesHashes.entrySet())assets.put(item.getKey(),new JSONObject()
                .put("pagesHash",item.getValue()).put("sha256",sha256(bytesFor(item.getKey()))));
        return new JSONObject().put("schemaVersion",2).put("assetIdentity",CloudflareArtifactManifest.ASSET_IDENTITY)
                .put("sourceRevision",sourceRevision).put("workflowRevision",workflowRevision).put("assets",assets).toString();
    }
    private byte[] bytesFor(String path){if("index.html".equals(path)||"asset.css".equals(path)||"copy.css".equals(path))return INDEX;if("assets/app.js".equals(path))return JS;if("__astro_static_studio/other.json".equals(path))return new byte[]{1};return "unlisted".getBytes(StandardCharsets.UTF_8);}
    private String sha256(byte[] bytes)throws Exception{StringBuilder value=new StringBuilder();for(byte item:MessageDigest.getInstance("SHA-256").digest(bytes))value.append(String.format(java.util.Locale.ROOT,"%02x",item&255));return value.toString();}
    private Map<String,String> hashes(){Map<String,String> assets=new LinkedHashMap<>();assets.put("index.html",A);assets.put("assets/app.js",B);return assets;}

    @Test public void acceptsExactMetadataAndAssetPathSetAndExcludesMetadataFile()throws Exception{
        CloudflareArtifactManifest parsed=CloudflareArtifactManifest.from(site(manifest(hashes()),new LinkedHashMap<>()));
        assertEquals(2,parsed.assets.size());assertEquals(A,parsed.assets.get("index.html").pagesHash);
        assertEquals(sha256(INDEX),parsed.assets.get("index.html").sha256);assertEquals(REVISION,parsed.sourceRevision);assertEquals(WORKFLOW,parsed.workflowRevision);
        assertFalse(parsed.assets.containsKey(CloudflareArtifactManifest.FILE_PATH));
    }

    @Test public void rejectsMissingMetadataWrongVersionIdentityRevisionsAndUnexpectedFields()throws Exception{
        try{CloudflareArtifactManifest.from(new GithubArtifactArchive.VerifiedSite(java.util.Collections.singletonMap("index.html",INDEX)));fail("manifest required");}catch(SecurityException expected){}
        for(String raw:new String[]{"{}","{\"schemaVersion\":1,\"assetIdentity\":\""+CloudflareArtifactManifest.ASSET_IDENTITY+"\",\"sourceRevision\":\""+REVISION+"\",\"workflowRevision\":\""+WORKFLOW+"\",\"assets\":{}}",
                manifest(hashes(),"main",WORKFLOW),manifest(hashes(),REVISION,"branch"),
                "{\"schemaVersion\":2,\"assetIdentity\":\"wrong\",\"sourceRevision\":\""+REVISION+"\",\"workflowRevision\":\""+WORKFLOW+"\",\"assets\":{}}",
                manifest(hashes()).replace("\"assets\":", "\"extra\":true,\"assets\":")})
            try{CloudflareArtifactManifest.from(site(raw,new LinkedHashMap<>()));fail("invalid manifest accepted");}catch(SecurityException expected){}
    }

    @Test public void rejectsDuplicateJsonKeysAndMalformedDigests()throws Exception{
        String duplicate="{\"schemaVersion\":2,\"assetIdentity\":\""+CloudflareArtifactManifest.ASSET_IDENTITY+"\",\"sourceRevision\":\""+REVISION+"\",\"workflowRevision\":\""+WORKFLOW+"\",\"assets\":{\"index.html\":{\"pagesHash\":\""+A+"\",\"sha256\":\""+sha256(INDEX)+"\"},\"index.html\":{\"pagesHash\":\""+A+"\",\"sha256\":\""+sha256(INDEX)+"\"}}}";
        try{CloudflareArtifactManifest.from(site(duplicate,new LinkedHashMap<>()));fail("duplicate JSON key accepted");}catch(SecurityException expected){}
        Map<String,String> bad=hashes();bad.put("assets/app.js","A".repeat(32));
        try{CloudflareArtifactManifest.from(site(manifest(bad),new LinkedHashMap<>()));fail("invalid Pages hash accepted");}catch(SecurityException expected){}
        String invalidSha=manifest(hashes()).replace("\"sha256\":\""+sha256(INDEX)+"\"","\"sha256\":\"A"+"0".repeat(63)+"\"");
        try{CloudflareArtifactManifest.from(site(invalidSha,new LinkedHashMap<>()));fail("invalid SHA-256 accepted");}catch(SecurityException expected){}
    }

    @Test public void rejectsPerFileSha256MismatchBeforeAcceptingVerifiedTree()throws Exception{
        String mismatch=manifest(hashes()).replace("\"sha256\":\""+sha256(INDEX)+"\"","\"sha256\":\""+"0".repeat(64)+"\"");
        try{CloudflareArtifactManifest.from(site(mismatch,new LinkedHashMap<>()));fail("tampered file digest accepted");}catch(SecurityException expected){assertTrue(expected.getMessage().contains("SHA-256"));}
    }

    @Test public void rejectsMissingExtraTraversalReservedAndUnlistedArtifactPaths()throws Exception{
        Map<String,String> missing=new LinkedHashMap<>();missing.put("index.html",A);
        try{CloudflareArtifactManifest.from(site(manifest(missing),new LinkedHashMap<>()));fail("unlisted asset accepted");}catch(SecurityException expected){}
        Map<String,String> extra=hashes();extra.put("extra.js",A);
        try{CloudflareArtifactManifest.from(site(manifest(extra),new LinkedHashMap<>()));fail("missing asset accepted");}catch(SecurityException expected){}
        Map<String,String> traversal=hashes();traversal.put("../secret",A);
        try{CloudflareArtifactManifest.from(site(manifest(traversal),new LinkedHashMap<>()));fail("traversal path accepted");}catch(SecurityException expected){}
        Map<String,String> reserved=hashes();reserved.put("__astro_static_studio/other.json",A);
        Map<String,byte[]> reservedFile=new LinkedHashMap<>();reservedFile.put("__astro_static_studio/other.json",new byte[]{1});
        try{CloudflareArtifactManifest.from(site(manifest(reserved),reservedFile));fail("reserved path accepted");}catch(SecurityException expected){}
    }

    @Test public void rejectsPagesHashMismatchAndAcceptsIdenticalSameExtensionAssets()throws Exception{
        Map<String,String> mismatch=hashes();mismatch.put("index.html","f".repeat(32));
        try{CloudflareArtifactManifest.from(site(manifest(mismatch),new LinkedHashMap<>()));fail("incorrect Pages hash accepted");}catch(SecurityException expected){assertTrue(expected.getMessage().contains("Pages hash"));}
        String cssHash=CloudflareArtifactManifest.pagesHash(INDEX,"asset.css");Map<String,String> duplicate=hashes();duplicate.put("asset.css",cssHash);duplicate.put("copy.css",cssHash);
        Map<String,byte[]> duplicates=new LinkedHashMap<>();duplicates.put("asset.css",INDEX.clone());duplicates.put("copy.css",INDEX.clone());
        CloudflareArtifactManifest parsed=CloudflareArtifactManifest.from(site(manifest(duplicate),duplicates));assertEquals(4,parsed.assets.size());
    }
}
