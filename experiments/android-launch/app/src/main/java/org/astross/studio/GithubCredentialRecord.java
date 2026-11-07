package org.astross.studio;

import org.json.JSONObject;

/** Pure encrypted-record transitions, kept separate so preservation can be tested without Android Keystore. */
final class GithubCredentialRecord {
    private GithubCredentialRecord(){}
    static JSONObject withTokens(JSONObject saved,String access,String refresh,String login,long accessExpiry,long refreshExpiry)throws Exception{
        return withTokens(saved,access,refresh,login,saved==null?0:saved.optLong("user_id",0),accessExpiry,refreshExpiry);
    }
    static JSONObject withTokens(JSONObject saved,String access,String refresh,String login,long userId,long accessExpiry,long refreshExpiry)throws Exception{
        JSONObject record=saved==null?new JSONObject():new JSONObject(saved.toString());
        String savedOwner=record.optString("project_owner","");long savedId=record.optLong("user_id",0);
        if(!login.isEmpty()&&!savedOwner.isEmpty()&&(!savedOwner.equalsIgnoreCase(login)||(savedId>0&&userId>0&&savedId!=userId)))removeProject(record);
        return record.put("access_token",access).put("refresh_token",refresh).put("login",login).put("user_id",userId)
                .put("expires_at",accessExpiry).put("refresh_expires_at",refreshExpiry);
    }
    static JSONObject withUserId(JSONObject saved,String login,long userId)throws Exception{
        if(saved==null||userId<=0||!login.equalsIgnoreCase(saved.optString("login","")))throw new IllegalArgumentException("Verified GitHub identity is required.");
        JSONObject record=new JSONObject(saved.toString());long prior=record.optLong("user_id",0);if(prior>0&&prior!=userId)removeProject(record);return record.put("user_id",userId);
    }
    static JSONObject clearCredentials(JSONObject saved)throws Exception{
        if(saved==null||!saved.has("project_id"))return null;
        JSONObject project=new JSONObject();
        project.put("project_id",saved.getLong("project_id")).put("project_owner",saved.getString("project_owner"))
                .put("project_name",saved.getString("project_name")).put("project_branch",saved.getString("project_branch")).put("project_owner_id",saved.optLong("project_owner_id",0));
        if(saved.has("user_id"))project.put("user_id",saved.getLong("user_id"));
        if(saved.optBoolean("project_initialized",false))project.put("project_initialized",true);
        return project;
    }
    static boolean hasCredentials(JSONObject saved){return saved!=null&&!saved.optString("access_token","").isEmpty();}
    private static void removeProject(JSONObject record){record.remove("project_id");record.remove("project_owner");record.remove("project_name");record.remove("project_branch");record.remove("project_initialized");record.remove("project_owner_id");record.remove("create_intent_name");record.remove("create_intent_owner_id");}
}
