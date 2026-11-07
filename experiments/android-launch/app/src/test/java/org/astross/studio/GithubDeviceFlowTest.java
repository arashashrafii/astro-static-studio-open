package org.astross.studio;

import org.json.JSONObject;
import org.junit.Test;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public final class GithubDeviceFlowTest {
    @Test public void handlesPendingAndSlowDownWithoutSendingSecret()throws Exception{
        ArrayDeque<JSONObject> response=new ArrayDeque<>();response.add(new JSONObject().put("device_code","private-device-code").put("user_code","ABCD-EFGH").put("verification_uri","https://github.com/login/device").put("expires_in",600).put("interval",5));
        response.add(new JSONObject().put("error","authorization_pending"));response.add(new JSONObject().put("error","slow_down"));response.add(new JSONObject().put("access_token","ghu-access").put("refresh_token","ghr-refresh").put("expires_in",28800).put("refresh_token_expires_in",15897600));
        List<String> requests=new ArrayList<>();List<Long> delays=new ArrayList<>();String[] code={""};
        GithubDeviceFlow flow=new GithubDeviceFlow((url,body)->{requests.add(body);return response.remove();},delays::add);
        GithubDeviceFlow.Tokens token=null;
        try{token=flow.authorize("public-client-id",(value,url,expires)->{code[0]=value;assertEquals("https://github.com/login/device",url);assertEquals(600,expires);},()->false);}catch(Exception error){fail(error.getMessage());}
        assertEquals("ABCD-EFGH",code[0]);assertEquals("ghu-access",token.accessToken);assertEquals("ghr-refresh",token.refreshToken);
        assertEquals(List.of(5000L,5000L,10000L),delays);assertTrue(requests.get(0).contains("scope=offline_access"));
        assertFalse(requests.toString().contains("client_secret"));
    }
    @Test public void rejectsUnexpectedVerificationAddress()throws Exception{
        GithubDeviceFlow flow=new GithubDeviceFlow((url,body)->new JSONObject().put("device_code","d").put("user_code","ABCD").put("verification_uri","https://evil.example"),ms->fail("Unexpected URL must fail before sleep"));
        try{flow.authorize("client",(c,u,e)->fail("Must not expose untrusted URL"),()->false);fail("Expected URL rejection");}
        catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("unexpected authorization address"));}catch(Exception other){fail(other.getMessage());}
    }
    @Test public void denialFailsWithoutReturningTokens()throws Exception{
        ArrayDeque<JSONObject> response=new ArrayDeque<>();response.add(device());response.add(new JSONObject().put("error","access_denied"));
        GithubDeviceFlow flow=new GithubDeviceFlow((url,body)->response.remove(),ms->{});
        try{flow.authorize("client",(c,u,e)->{},()->false);fail("Expected denial");}
        catch(IllegalStateException expected){assertEquals("GitHub authorization was declined",expected.getMessage());}catch(Exception other){fail(other.getMessage());}
    }
    @Test public void refreshUsesPublicClientAndRotatesTokens()throws Exception{
        List<String> body=new ArrayList<>();GithubDeviceFlow flow=new GithubDeviceFlow((url,value)->{body.add(value);return validTokens();},ms->fail("No polling in refresh"));
        try{GithubDeviceFlow.Tokens result=flow.refresh("public-client-id","old-refresh");assertEquals("new-access",result.accessToken);assertEquals("new-refresh",result.refreshToken);}
        catch(Exception error){fail(error.getMessage());}
        assertTrue(body.get(0).contains("grant_type=refresh_token"));assertTrue(body.get(0).contains("refresh_token=old-refresh"));assertFalse(body.get(0).contains("client_secret"));
    }
    @Test public void refreshFailsClosedIfRotatedTokenMissing()throws Exception{
        GithubDeviceFlow flow=new GithubDeviceFlow((url,body)->new JSONObject().put("access_token","new-access").put("expires_in",28800),ms->{});
        try{flow.refresh("client","old");fail("Must not reuse consumed token");}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("invalid authorization response"));}catch(Exception other){fail(other.getMessage());}
    }
    @Test public void refreshFailsClosedIfRotatedTokenExpiryMissing()throws Exception{
        GithubDeviceFlow flow=new GithubDeviceFlow((url,body)->new JSONObject().put("access_token","new-access").put("refresh_token","new-refresh").put("expires_in",28800),ms->{});
        try{flow.refresh("client","old");fail("Rotated token expiry required");}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("invalid authorization lifetime"));}catch(Exception other){fail(other.getMessage());}
    }
    @Test public void cancelDuringPollDiscardsLateResponse()throws Exception{
        ArrayDeque<JSONObject> response=new ArrayDeque<>();response.add(device());response.add(new JSONObject().put("error","authorization_pending"));boolean[] cancelled={false};int[] requests={0};
        GithubDeviceFlow flow=new GithubDeviceFlow((url,body)->{requests[0]++;JSONObject value=response.remove();if(url.endsWith("access_token"))cancelled[0]=true;return value;},ms->{});
        try{assertEquals(null,flow.authorize("client",(c,u,e)->{},()->cancelled[0]));}catch(Exception error){fail(error.getMessage());}
        assertEquals(2,requests[0]);
    }
    @Test public void redirectedOrBlankGitHubIdentityIsNotVerified(){
        try{GithubDeviceFlow.validateIdentityResponse(302,"octocat");fail("Redirects must not verify identity");}
        catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("redirected"));}
        try{GithubDeviceFlow.validateIdentityResponse(200,"");fail("Blank login must not verify identity");}
        catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("invalid account identity"));}
        try{GithubDeviceFlow.validateIdentityResponse(200,"octocat",0);fail("Missing immutable account ID must not verify identity");}
        catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("invalid account identity"));}
    }
    private JSONObject device()throws Exception{return new JSONObject().put("device_code","device").put("user_code","ABCD-EFGH").put("verification_uri","https://github.com/login/device").put("expires_in",300).put("interval",5);}
    private JSONObject validTokens()throws Exception{return new JSONObject().put("access_token","new-access").put("refresh_token","new-refresh").put("expires_in",28800).put("refresh_token_expires_in",15897600);}
}
