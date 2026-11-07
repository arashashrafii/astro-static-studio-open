package org.astross.studio;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

final class GithubDeviceFlow {
    interface Progress { void onCode(String code,String verificationUrl,long expiresIn)throws Exception; }
    interface Cancelled { boolean isCancelled(); }
    interface Poster { JSONObject post(String address,String body)throws Exception; }
    interface Sleeper { void sleep(long ms)throws InterruptedException; }
    static final class Tokens {
        final String accessToken,refreshToken;
        final long expiresIn,refreshExpiresIn;
        Tokens(String a,String r,long e,long re){accessToken=a;refreshToken=r;expiresIn=e;refreshExpiresIn=re;}
    }
    private final Poster poster;private final Sleeper sleeper;
    GithubDeviceFlow(){this(GithubDeviceFlow::post,Thread::sleep);}
    GithubDeviceFlow(Poster poster,Sleeper sleeper){this.poster=poster;this.sleeper=sleeper;}

    Tokens authorize(String clientId,Progress progress,Cancelled cancelled)throws Exception{
        JSONObject device=poster.post("https://github.com/login/device/code","client_id="+enc(clientId)+"&scope=offline_access");
        String deviceCode=required(device,"device_code"),userCode=required(device,"user_code");
        String verification=device.optString("verification_uri","https://github.com/login/device");
        if(!"https://github.com/login/device".equals(verification))throw new IllegalStateException("GitHub returned an unexpected authorization address");
        long expires=positive(device.optLong("expires_in",0)),interval=Math.max(5,positive(device.optLong("interval",5)));
        progress.onCode(userCode,verification,expires);
        long stop=System.currentTimeMillis()+expires*1000;
        while(!cancelled.isCancelled()&&System.currentTimeMillis()<stop){
            sleeper.sleep(interval*1000);if(cancelled.isCancelled())return null;
            JSONObject token=poster.post("https://github.com/login/oauth/access_token","client_id="+enc(clientId)+
                    "&device_code="+enc(deviceCode)+"&grant_type="+enc("urn:ietf:params:oauth:grant-type:device_code"));
            if(cancelled.isCancelled())return null;
            String error=token.optString("error","");
            if("authorization_pending".equals(error))continue;
            if("slow_down".equals(error)){interval+=5;continue;}
            if("access_denied".equals(error))throw new IllegalStateException("GitHub authorization was declined");
            if("expired_token".equals(error))throw new IllegalStateException("GitHub authorization code expired; try again");
            if(!error.isEmpty())throw new IllegalStateException("GitHub authorization could not be completed");
            return tokens(token);
        }
        if(cancelled.isCancelled())return null;
        throw new IllegalStateException("GitHub authorization code expired; try again");
    }
    Tokens refresh(String clientId,String refreshToken)throws Exception{
        JSONObject token=poster.post("https://github.com/login/oauth/access_token","client_id="+enc(clientId)+
                "&grant_type=refresh_token&refresh_token="+enc(refreshToken));
        String error=token.optString("error","");
        if(!error.isEmpty())throw new IllegalStateException("bad_refresh_token".equals(error)?"GitHub authorization expired; sign in again":"GitHub authorization could not be refreshed");
        return tokens(token);
    }
    static final class UserIdentity{final String login;final long id;UserIdentity(String login,long id){this.login=login;this.id=id;}}
    static String authenticatedLogin(String accessToken)throws Exception{return authenticatedIdentity(accessToken).login;}
    static UserIdentity authenticatedIdentity(String accessToken)throws Exception{
        HttpURLConnection connection=(HttpURLConnection)new URL("https://api.github.com/user").openConnection();
        connection.setConnectTimeout(10000);connection.setReadTimeout(10000);connection.setInstanceFollowRedirects(false);connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept","application/vnd.github+json");
        connection.setRequestProperty("User-Agent","AstroStaticStudioAndroid/0.2");
        connection.setRequestProperty("Authorization","Bearer "+accessToken);connection.setRequestProperty("X-GitHub-Api-Version","2022-11-28");
        try{
            int status=connection.getResponseCode();
            if(status>=300&&status<400)throw new IllegalStateException("GitHub redirected account verification; connection was not accepted");
            if(status<200||status>=300)throw new IllegalStateException("GitHub account identity could not be verified");
            try(InputStream input=connection.getInputStream()){
                byte[] data=readBounded(input,32768);JSONObject profile=new JSONObject(new String(data,StandardCharsets.UTF_8));String login=profile.optString("login","");long id=profile.optLong("id",0);
                return validateIdentityResponse(status,login,id);
            }
        }finally{connection.disconnect();}
    }
    static String validateIdentityResponse(int status,String login){return validateIdentityResponse(status,login,1).login;}
    static UserIdentity validateIdentityResponse(int status,String login,long id){
        if(status>=300&&status<400)throw new IllegalStateException("GitHub redirected account verification; connection was not accepted");
        if(status<200||status>=300)throw new IllegalStateException("GitHub account identity could not be verified");
        if(login==null||!login.matches("[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?")||id<=0)
            throw new IllegalStateException("GitHub returned an invalid account identity");
        return new UserIdentity(login,id);
    }
    private static Tokens tokens(JSONObject value){
        String access=required(value,"access_token"),refresh=required(value,"refresh_token");
        long accessExpiry=positive(value.optLong("expires_in",0)),refreshExpiry=positive(value.optLong("refresh_token_expires_in",0));
        return new Tokens(access,refresh,accessExpiry,refreshExpiry);
    }
    private static JSONObject post(String address,String body)throws Exception{
        HttpURLConnection connection=(HttpURLConnection)new URL(address).openConnection();connection.setRequestMethod("POST");
        connection.setConnectTimeout(10000);connection.setReadTimeout(10000);connection.setInstanceFollowRedirects(false);connection.setDoOutput(true);
        connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Content-Type","application/x-www-form-urlencoded; charset=UTF-8");
        byte[] payload=body.getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(payload.length);
        try(OutputStream output=connection.getOutputStream()){output.write(payload);}
        try{
            int status=connection.getResponseCode();InputStream input=status>=200&&status<300?connection.getInputStream():connection.getErrorStream();
            if(input==null)throw new IllegalStateException("GitHub authorization service is unavailable");
            try(InputStream stream=input){JSONObject response=new JSONObject(new String(readBounded(stream,32768),StandardCharsets.UTF_8));
                if(status<200||status>=300)throw new IllegalStateException("GitHub authorization service is unavailable");return response;}
        }finally{connection.disconnect();}
    }
    private static byte[] readBounded(InputStream input,int max)throws Exception{
        ByteArrayOutputStream data=new ByteArrayOutputStream();byte[] buffer=new byte[2048];int count;
        while((count=input.read(buffer))!=-1){if(data.size()+count>max)throw new IllegalStateException("GitHub returned an invalid response");data.write(buffer,0,count);}return data.toByteArray();
    }
    private static String required(JSONObject object,String key){String value=object.optString(key,"");if(value.isEmpty())throw new IllegalStateException("GitHub returned an invalid authorization response");return value;}
    private static long positive(long value){if(value<=0||value>31_536_000)throw new IllegalStateException("GitHub returned an invalid authorization lifetime");return value;}
    private static String enc(String value)throws Exception{return URLEncoder.encode(value,"UTF-8");}
}
