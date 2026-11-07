package org.astross.studio;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class GithubCredentialRecordTest {
    private JSONObject saved()throws Exception{return new JSONObject().put("access_token","secret-access").put("refresh_token","secret-refresh").put("login","octocat")
            .put("expires_at",123).put("refresh_expires_at",456).put("user_id",42).put("project_id",987).put("project_owner_id",42).put("project_owner","octocat").put("project_name","my-site").put("project_branch","main").put("project_initialized",true);}
    @Test public void refreshedCredentialsKeepTheVerifiedProjectBinding()throws Exception{
        JSONObject record=GithubCredentialRecord.withTokens(saved(),"rotated-access","rotated-refresh","octocat",1000,2000);
        assertEquals(987,record.getLong("project_id"));assertEquals("my-site",record.getString("project_name"));assertEquals("rotated-access",record.getString("access_token"));assertEquals(42,record.getLong("user_id"));
    }
    @Test public void aDifferentVerifiedOwnerCannotInheritThePriorProject()throws Exception{
        JSONObject record=GithubCredentialRecord.withTokens(saved(),"other-access","other-refresh","other-user",1000,2000);
        assertFalse(record.has("project_id"));assertEquals("other-user",record.getString("login"));
    }
    @Test public void aReusedLoginWithDifferentImmutableUserIdCannotInheritProject()throws Exception{
        JSONObject record=GithubCredentialRecord.withTokens(saved(),"new-access","new-refresh","octocat",43,1000,2000);
        assertFalse(record.has("project_id"));assertEquals(43,record.getLong("user_id"));
    }
    @Test public void localSignOutRemovesTokensButKeepsOnlyEncryptedProjectIdentityForReauth()throws Exception{
        JSONObject project=GithubCredentialRecord.clearCredentials(saved());assertNotNull(project);
        assertFalse(GithubCredentialRecord.hasCredentials(project));assertFalse(project.has("access_token"));assertFalse(project.has("refresh_token"));
        assertEquals(987,project.getLong("project_id"));assertEquals(42,project.getLong("user_id"));assertEquals(42,project.getLong("project_owner_id"));assertTrue(project.getBoolean("project_initialized"));
        assertNull(GithubCredentialRecord.clearCredentials(new JSONObject().put("access_token","secret")));
    }
}
