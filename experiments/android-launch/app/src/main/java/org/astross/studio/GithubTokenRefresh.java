package org.astross.studio;

import org.json.JSONObject;

final class GithubTokenRefresh {
    interface Refresher { GithubDeviceFlow.Tokens refresh(String clientId,String refreshToken)throws Exception; }
    interface Identity { String login(String accessToken)throws Exception; }
    interface Saver { void save(String access,String refresh,String login,long expires,long refreshExpires)throws Exception; }
    static final class Result {
        final String login;final boolean refreshed,cancelled;
        Result(String login,boolean refreshed,boolean cancelled){this.login=login;this.refreshed=refreshed;this.cancelled=cancelled;}
    }
    private GithubTokenRefresh(){}
    static Result restore(JSONObject record,long now,String clientId,AuthGeneration gate,long ticket,
                          Refresher refresher,Identity identity,Saver saver)throws Exception{
        String access=record.optString("access_token",""),refresh=record.optString("refresh_token",""),login=record.optString("login","");
        long expires=record.optLong("expires_at",0),refreshExpires=record.optLong("refresh_expires_at",0);
        if(access.isEmpty())throw new IllegalStateException("Saved GitHub authorization is invalid; sign in again");
        boolean refreshed=expires<=now+60000;
        if(refreshed){
            if(refresh.isEmpty()||refreshExpires<=now)throw new IllegalStateException("GitHub authorization expired; sign in again");
            GithubDeviceFlow.Tokens tokens=refresher.refresh(clientId,refresh);
            access=tokens.accessToken;refresh=tokens.refreshToken;expires=now+tokens.expiresIn*1000;refreshExpires=now+tokens.refreshExpiresIn*1000;
        }
        String priorLogin=login;
        try{login=identity.login(access);}catch(Exception ignored){login="";}
        if(refreshed||!login.isEmpty()&&!priorLogin.equals(login)){
            String finalAccess=access,finalRefresh=refresh,finalLogin=login;long finalExpiry=expires,finalRefreshExpiry=refreshExpires;
            if(!gate.runIfCurrent(ticket,()->saver.save(finalAccess,finalRefresh,finalLogin,finalExpiry,finalRefreshExpiry)))
                return new Result("",false,true);
        }
        if(!gate.isCurrent(ticket))return new Result("",false,true);
        return new Result(login,refreshed,false);
    }
}
