package org.astross.studio;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

public final class GithubContentValidatorTest {
    private GithubContentValidator validator()throws Exception{return GithubContentValidator.from(getClass().getResourceAsStream("/content.schema.json"),getClass().getResourceAsStream("/content-invariants.json"));}
    @Test public void acceptsAndRejectsCanonicalDifferentialCorpus()throws Exception{
        JSONObject vectors=new JSONObject(new String(read("/content-schema-vectors.json"),StandardCharsets.UTF_8));GithubContentValidator v=validator();
        JSONArray accepted=vectors.getJSONArray("accepted");for(int i=0;i<accepted.length();i++){JSONObject item=accepted.getJSONObject(i);try{v.validate(item.getJSONObject("content"));}catch(Exception e){fail("Java rejected canonical accepted vector "+item.getString("name")+": "+e.getMessage());}}
        JSONArray rejected=vectors.getJSONArray("rejected");for(int i=0;i<rejected.length();i++){JSONObject item=rejected.getJSONObject(i);try{v.validate(item.getJSONObject("content"));fail("Java accepted canonical rejected vector "+item.getString("name"));}catch(IllegalArgumentException expected){}}
    }
    @Test public void failsClosedOnUnknownSchemaAssertion()throws Exception{
        GithubContentValidator bad=new GithubContentValidator(new JSONObject().put("type","object").put("x-unreviewed",true));
        try{bad.validate(new JSONObject());fail("unknown assertions must fail closed");}catch(IllegalArgumentException expected){assertTrue(expected.getMessage().contains("Unsupported"));}
        GithubContentValidator hidden=new GithubContentValidator(new JSONObject().put("anyOf",new JSONArray().put(new JSONObject().put("type","object")).put(new JSONObject().put("x-hidden",true))));
        try{hidden.validate(new JSONObject());fail("unknown assertions in an unused branch must fail closed");}catch(IllegalArgumentException expected){assertTrue(expected.getMessage().contains("Unsupported"));}
    }
    @Test public void plainTextFieldEnforcesCanonicalFiftyThousandCharacterLimit()throws Exception{
        GithubContentValidator v=validator();JSONObject field=new JSONObject().put("id","10000000-0000-4000-8000-000000000011").put("type","text").put("label","Body");
        JSONObject collection=new JSONObject().put("id","10000000-0000-4000-8000-000000000010").put("slug","stories").put("routeBase","stories").put("name","Stories").put("kind","content").put("listLayout","grid").put("loading","show-more").put("pageSize",12).put("fields",new JSONArray().put(field));
        JSONObject item=new JSONObject().put("id","10000000-0000-4000-8000-000000000012").put("collectionId",collection.getString("id")).put("slug","entry").put("published",false).put("title","Entry").put("description",new JSONObject().put("source","manual").put("value",""));
        JSONObject content=new JSONObject().put("version",2).put("site",new JSONObject().put("name","Example").put("tagline","").put("email","").put("phone","").put("language","en").put("direction","ltr")).put("pages",new JSONArray()).put("collections",new JSONArray().put(collection)).put("items",new JSONArray());
        item.put("values",new JSONObject().put(field.getString("id"),"x".repeat(50_000)));content.getJSONArray("items").put(item);v.validate(content);
        item.getJSONObject("values").put(field.getString("id"),"x".repeat(50_001));
        try{v.validate(content);fail("Native validator must match the canonical 50,000 character plain-text limit");}catch(IllegalArgumentException expected){assertTrue(expected.getMessage().contains("maxLength"));}
    }
    private byte[] read(String resource)throws Exception{try(InputStream in=getClass().getResourceAsStream(resource)){assertNotNull(resource,in);return in.readAllBytes();}}
}
