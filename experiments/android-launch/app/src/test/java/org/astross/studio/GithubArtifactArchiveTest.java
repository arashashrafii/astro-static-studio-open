package org.astross.studio;

import org.junit.Test;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.CRC32;
import static org.junit.Assert.*;

public final class GithubArtifactArchiveTest {
    private static final class Part { final String name;final byte[] data;final int mode;Part(String name,byte[] data,int mode){this.name=name;this.data=data;this.mode=mode;} }
    private byte[] site()throws Exception{return zip(new Part("index.html","<h1>ok</h1>".getBytes(StandardCharsets.UTF_8),0100644),new Part("assets/",new byte[0],0040755),new Part("assets/site.css","body{}".getBytes(StandardCharsets.UTF_8),0100644));}

    @Test public void acceptsValidRootedStaticSiteAndReturnsBytesWithoutExtraction()throws Exception{
        GithubArtifactArchive.VerifiedSite site=GithubArtifactArchive.validate(site());
        assertEquals("<h1>ok</h1>",new String(site.file("index.html"),StandardCharsets.UTF_8));
        assertEquals("body{}",new String(site.file("assets/site.css"),StandardCharsets.UTF_8));assertNull(site.file("missing.js"));
        byte[] copy=site.file("index.html");copy[0]='X';assertEquals("<h1>ok</h1>",new String(site.file("index.html"),StandardCharsets.UTF_8));
    }

    @Test public void rejectsAbsoluteTraversalBackslashAndAliasedDuplicatePaths()throws Exception{
        for(String bad:new String[]{"/index.html","../index.html","a/../../b","a\\b","C:/index.html","folder//file.js","folder/./file.js"})
            reject(zip(new Part(bad,new byte[]{1},0100644)));
        reject(zip(new Part("index.html",new byte[]{1},0100644),new Part("assets/../index.html",new byte[]{2},0100644)));
        reject(zip(new Part("index.html",new byte[]{1},0100644),new Part("assets.css",new byte[]{1},0100644),new Part("ASSETS.css",new byte[]{2},0100644)));
    }

    @Test public void rejectsLinksAndNonRegularEntryTypes()throws Exception{
        reject(zip(new Part("index.html",new byte[]{1},0100644),new Part("shortcut",new byte[]{2},0120777)));
        reject(zip(new Part("index.html",new byte[]{1},0100644),new Part("device",new byte[0],0020600)));
        byte[] unknownPlatform=zip(new Part("index.html",new byte[]{1},0100644));int central=find(unknownPlatform,new byte[]{0x50,0x4b,0x01,0x02});put16(unknownPlatform,central+4,(10<<8)|20);reject(unknownPlatform);
    }

    @Test public void requiresExactlyOneRootIndexAndRejectsMalformedHeaders()throws Exception{
        reject(zip(new Part("nested/index.html",new byte[]{1},0100644)));
        byte[] corrupt=site();corrupt[0]=0;reject(corrupt);
    }

    @Test public void rejectsDuplicateEntriesAndExcessiveEntryCounts()throws Exception{
        reject(zip(new Part("index.html",new byte[]{1},0100644),new Part("index.html",new byte[]{2},0100644)));
        List<Part> many=new ArrayList<>();many.add(new Part("index.html",new byte[]{1},0100644));for(int i=0;i<500;i++)many.add(new Part("f"+i,new byte[0],0100644));
        reject(zip(many.toArray(new Part[0])));
    }

    @Test public void rejectsEntryDeclaredLargerThanPerFileLimitBeforeInflating()throws Exception{
        byte[] crafted=zip(new Part("index.html",new byte[]{1},0100644));
        int central=find(crafted,new byte[]{0x50,0x4b,0x01,0x02});put32(crafted,central+24,(long)GithubArtifactArchive.MAX_FILE_BYTES+1);put32(crafted,central+20,1);reject(crafted);
    }

    private static void reject(byte[] archive)throws Exception{try{GithubArtifactArchive.validate(archive);fail("archive should have been rejected");}catch(SecurityException expected){assertNotNull(expected.getMessage());}}

    private static byte[] zip(Part... parts)throws Exception{
        ByteArrayOutputStream output=new ByteArrayOutputStream();List<Integer> offsets=new ArrayList<>();List<byte[]> names=new ArrayList<>();List<Long> crcs=new ArrayList<>();
        for(Part part:parts){byte[] name=part.name.getBytes(StandardCharsets.UTF_8),data=part.data;CRC32 crc=new CRC32();crc.update(data);int flags=part.name.chars().anyMatch(c->c>127)?0x800:0;offsets.add(output.size());names.add(name);crcs.add(crc.getValue());
            put32(output,0x04034b50L);put16(output,20);put16(output,flags);put16(output,0);put16(output,0);put16(output,0);put32(output,crc.getValue());put32(output,data.length);put32(output,data.length);put16(output,name.length);put16(output,0);output.write(name);output.write(data);}
        int directoryOffset=output.size();
        for(int i=0;i<parts.length;i++){Part part=parts[i];byte[] name=names.get(i);put32(output,0x02014b50L);put16(output,(3<<8)|20);put16(output,20);put16(output,part.name.chars().anyMatch(c->c>127)?0x800:0);put16(output,0);put16(output,0);put16(output,0);put32(output,crcs.get(i));put32(output,part.data.length);put32(output,part.data.length);put16(output,name.length);put16(output,0);put16(output,0);put16(output,0);put16(output,0);put32(output,((long)part.mode)<<16);put32(output,offsets.get(i));output.write(name);}
        int directorySize=output.size()-directoryOffset;put32(output,0x06054b50L);put16(output,0);put16(output,0);put16(output,parts.length);put16(output,parts.length);put32(output,directorySize);put32(output,directoryOffset);put16(output,0);return output.toByteArray();
    }
    private static void put16(ByteArrayOutputStream out,int value){out.write(value&255);out.write((value>>>8)&255);}
    private static void put32(ByteArrayOutputStream out,long value){for(int shift=0;shift<32;shift+=8)out.write((int)(value>>>shift)&255);}
    private static void put16(byte[] bytes,int offset,int value){bytes[offset]=(byte)value;bytes[offset+1]=(byte)(value>>>8);}
    private static int find(byte[] bytes,byte[] signature){outer:for(int i=0;i<=bytes.length-signature.length;i++){for(int j=0;j<signature.length;j++)if(bytes[i+j]!=signature[j])continue outer;return i;}return -1;}
    private static void put32(byte[] bytes,int offset,long value){for(int shift=0;shift<32;shift+=8)bytes[offset+shift/8]=(byte)(value>>>shift);}
}
