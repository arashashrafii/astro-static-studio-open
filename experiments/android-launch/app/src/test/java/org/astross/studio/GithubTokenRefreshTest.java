package org.astross.studio;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public final class GithubTokenRefreshTest {
    @Test public void activeTokenDoesNotRefreshOrRewrite()throws Exception{
        AuthGeneration gate=new AuthGeneration();long ticket=gate.advance();
        GithubTokenRefresh.Result result=GithubTokenRefresh.restore(new JSONObject().put("access_token","a").put("refresh_token","r").put("login","user").put("expires_at",200000).put("refresh_expires_at",900000),
                100000,"client",gate,ticket,(c,r)->{fail("No refresh expected");return null;},a->"user",(a,r,l,e,re)->fail("No write expected"));
        assertFalse(result.refreshed);assertFalse(result.cancelled);assertEquals("user",result.login);
    }
    @Test public void cachedIdentityIsNotReportedConnectedWhenGithubCheckFails()throws Exception{
        AuthGeneration gate=new AuthGeneration();long ticket=gate.advance();
        GithubTokenRefresh.Result result=GithubTokenRefresh.restore(new JSONObject().put("access_token","a").put("refresh_token","r").put("login","old-login").put("expires_at",200000).put("refresh_expires_at",900000),
                100000,"client",gate,ticket,(c,r)->{fail("No refresh expected");return null;},a->{throw new IllegalStateException("profile request failed");},(a,r,l,e,re)->fail("Identity failure must not rewrite cached identity"));
        assertEquals("",result.login);assertFalse(result.refreshed);assertFalse(result.cancelled);
    }
    @Test public void refreshRotationAndExpiryArePersisted()throws Exception{
        AuthGeneration gate=new AuthGeneration();long ticket=gate.advance();String[] record=new String[3];long[] expiry=new long[2];
        GithubTokenRefresh.Result result=GithubTokenRefresh.restore(new JSONObject().put("access_token","old-a").put("refresh_token","old-r").put("expires_at",100000).put("refresh_expires_at",900000),
                100000,"client",gate,ticket,(c,r)->new GithubDeviceFlow.Tokens("new-a","new-r",28800,15897600),a->"octocat",
                (a,r,l,e,re)->{record[0]=a;record[1]=r;record[2]=l;expiry[0]=e;expiry[1]=re;});
        assertTrue(result.refreshed);assertEquals("new-a",record[0]);assertEquals("new-r",record[1]);assertEquals("octocat",record[2]);
        assertEquals(28900000L,expiry[0]);assertEquals(15897700000L,expiry[1]);
    }
    @Test public void expiryWithoutValidRefreshFailsClosed()throws Exception{
        AuthGeneration gate=new AuthGeneration();long ticket=gate.advance();
        try{GithubTokenRefresh.restore(new JSONObject().put("access_token","old-a").put("expires_at",100000),100000,"client",gate,ticket,
                    (c,r)->{fail("Refresh token was missing");return null;},a->"",(a,r,l,e,re)->fail("Do not persist expired auth"));fail("Expected expiry error");}
        catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("expired"));}
    }
    @Test public void canceledRefreshDoesNotSaveLateRotatedToken()throws Exception{
        AuthGeneration gate=new AuthGeneration();long ticket=gate.advance();int[] writes={0};
        GithubTokenRefresh.Result result=GithubTokenRefresh.restore(new JSONObject().put("access_token","old-a").put("refresh_token","old-r").put("expires_at",100000).put("refresh_expires_at",900000),
                100000,"client",gate,ticket,(c,r)->{gate.advance();return new GithubDeviceFlow.Tokens("new-a","new-r",28800,15897600);},a->"",
                (a,r,l,e,re)->writes[0]++);
        assertTrue(result.cancelled);assertFalse(result.refreshed);assertEquals(0,writes[0]);
    }
    @Test public void refreshRotationPersistsEvenWhenIdentityLookupFails()throws Exception{
        AuthGeneration gate=new AuthGeneration();long ticket=gate.advance();String[] saved=new String[2];
        GithubTokenRefresh.Result result=GithubTokenRefresh.restore(new JSONObject().put("access_token","old-a").put("refresh_token","old-r").put("expires_at",100000).put("refresh_expires_at",900000),
                100000,"client",gate,ticket,(c,r)->new GithubDeviceFlow.Tokens("new-a","new-r",28800,15897600),
                a->{throw new IllegalStateException("profile endpoint unavailable");},(a,r,l,e,re)->{saved[0]=a;saved[1]=r;});
        assertTrue(result.refreshed);assertEquals("new-a",saved[0]);assertEquals("new-r",saved[1]);assertEquals("",result.login);
    }
}
