package org.astross.studio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Validates the ZIP directory and every inflated entry without writing to disk. */
final class GithubArtifactArchive {
    static final int MAX_ENTRIES=500;
    static final int MAX_FILE_BYTES=8*1024*1024;
    static final int MAX_TOTAL_BYTES=32*1024*1024;
    private static final long U32_MAX=0xffffffffL;
    private static final int UTF8_FLAG=1<<11, DATA_DESCRIPTOR_FLAG=1<<3;

    static final class VerifiedSite {
        private final Map<String,byte[]> files;
        final String sourceRevision,workflowRevision;
        VerifiedSite(Map<String,byte[]> files){this(files,null,null);}
        private VerifiedSite(Map<String,byte[]> files,String sourceRevision,String workflowRevision){this.files=Collections.unmodifiableMap(new HashMap<>(files));this.sourceRevision=sourceRevision;this.workflowRevision=workflowRevision;}
        VerifiedSite withVerifiedRevisions(String sourceRevision,String workflowRevision){if(sourceRevision==null||!sourceRevision.matches("[0-9a-f]{40}")||workflowRevision==null||!workflowRevision.matches("[0-9a-f]{40}"))throw invalid("Verified source and workflow revisions are required.");return new VerifiedSite(files,sourceRevision,workflowRevision);}
        byte[] file(String path){byte[] value=files.get(path);return value==null?null:value.clone();}
        Map<String,byte[]> files(){Map<String,byte[]> copy=new HashMap<>();for(Map.Entry<String,byte[]> item:files.entrySet())copy.put(item.getKey(),item.getValue().clone());return Collections.unmodifiableMap(copy);}
    }
    private static final class Entry {
        final String name; final byte[] rawName; final int flags,method; final long compressedSize,size,crc,localOffset; final boolean directory;
        Entry(String name,byte[] rawName,int flags,int method,long compressedSize,long size,long crc,long localOffset,boolean directory){this.name=name;this.rawName=rawName;this.flags=flags;this.method=method;this.compressedSize=compressedSize;this.size=size;this.crc=crc;this.localOffset=localOffset;this.directory=directory;}
    }

    private GithubArtifactArchive(){}
    static VerifiedSite validate(byte[] zip)throws Exception{
        if(zip==null||zip.length<22||zip.length>GithubArtifactDownloader.MAX_COMPRESSED_BYTES)throw invalid("The compressed artifact size is outside the supported limit.");
        List<Entry> entries=readDirectory(zip);Map<String,byte[]> files=new HashMap<>();Set<String> seen=new HashSet<>();long declaredTotal=0;
        for(Entry entry:entries){
            String key=pathKey(entry.name);
            if(!seen.add(key))throw invalid("The artifact contains duplicate or aliased paths.");
            if(entry.size>MAX_FILE_BYTES||entry.compressedSize>GithubArtifactDownloader.MAX_COMPRESSED_BYTES)throw invalid("An artifact entry is larger than the supported limit.");
            if(entry.directory&&entry.size!=0)throw invalid("Artifact directories cannot contain file data.");
            declaredTotal+=entry.size;if(declaredTotal>MAX_TOTAL_BYTES)throw invalid("The expanded artifact exceeds the supported size limit.");
        }
        ByteArrayInputStream raw=new ByteArrayInputStream(zip);ZipInputStream input=new ZipInputStream(raw,StandardCharsets.UTF_8);long actualTotal=0;int count=0;boolean hasIndex=false;
        try{
            ZipEntry current;
            while((current=input.getNextEntry())!=null){
                if(count>=entries.size())throw invalid("The ZIP contains entries missing from its directory.");
                Entry meta=entries.get(count++);
                if(!meta.name.equals(current.getName())||meta.method!=current.getMethod())throw invalid("ZIP local and central entry names do not match.");
                ByteArrayOutputStream output=meta.directory?null:new ByteArrayOutputStream((int)Math.min(meta.size,8192));byte[] chunk=new byte[8192];long entryBytes=0;int read;
                while((read=input.read(chunk))!=-1){entryBytes+=read;actualTotal+=read;if(entryBytes>MAX_FILE_BYTES||actualTotal>MAX_TOTAL_BYTES)throw invalid("The expanded artifact exceeds the supported size limit.");if(output!=null)output.write(chunk,0,read);}
                input.closeEntry();
                if(entryBytes!=meta.size)throw invalid("ZIP entry size does not match its directory metadata.");
                if(!meta.directory){byte[] bytes=output.toByteArray();files.put(meta.name,bytes);if("index.html".equals(meta.name))hasIndex=true;}
            }
        }finally{input.close();}
        if(count!=entries.size())throw invalid("The ZIP contains entries missing from its local data.");
        if(actualTotal!=declaredTotal)throw invalid("The ZIP expanded size did not match its directory metadata.");
        if(!hasIndex)throw invalid("The artifact has no root index.html.");
        return new VerifiedSite(files);
    }

    static void validateRelativeFilePath(String path)throws Exception{
        if(validatePath(path))throw invalid("The path must name a regular file.");
    }

    private static List<Entry> readDirectory(byte[] zip)throws Exception{
        int eocd=-1,start=Math.max(0,zip.length-22-65535);
        for(int i=zip.length-22;i>=start;i--)if(u32(zip,i)==0x06054b50L&&i+22+u16(zip,i+20)==zip.length){eocd=i;break;}
        if(eocd<0)throw invalid("The artifact is not a complete ZIP archive.");
        if(u16(zip,eocd+4)!=0||u16(zip,eocd+6)!=0||u16(zip,eocd+8)!=u16(zip,eocd+10))throw invalid("Multi-disk ZIP archives are not supported.");
        int count=u16(zip,eocd+10);long directorySize=u32(zip,eocd+12),directoryOffset=u32(zip,eocd+16);
        if(count==0xffff||directorySize==U32_MAX||directoryOffset==U32_MAX)throw invalid("ZIP64 archives are not supported.");
        if(count<1||count>MAX_ENTRIES||directoryOffset+directorySize!=eocd)throw invalid("The ZIP directory is outside the supported bounds.");
        int cursor=(int)directoryOffset,end=(int)(directoryOffset+directorySize);List<Entry> entries=new ArrayList<>(count);Set<String> paths=new HashSet<>();long declaredTotal=0;
        for(int index=0;index<count;index++){
            require(zip,cursor,46);if(u32(zip,cursor)!=0x02014b50L)throw invalid("The ZIP directory entry is malformed.");
            int madeBy=u16(zip,cursor+4),flags=u16(zip,cursor+8),method=u16(zip,cursor+10),nameLength=u16(zip,cursor+28),extraLength=u16(zip,cursor+30),commentLength=u16(zip,cursor+32),disk=u16(zip,cursor+34);
            long crc=u32(zip,cursor+16),compressed=u32(zip,cursor+20),size=u32(zip,cursor+24),external=u32(zip,cursor+38),local=u32(zip,cursor+42);
            if(disk!=0||compressed==U32_MAX||size==U32_MAX||local==U32_MAX)throw invalid("ZIP64 or split entries are not supported.");
            if(compressed>GithubArtifactDownloader.MAX_COMPRESSED_BYTES||size>MAX_FILE_BYTES||(declaredTotal+=size)>MAX_TOTAL_BYTES)throw invalid("ZIP entry sizes exceed the supported limits.");
            if((flags&0x0001)!=0||(flags&0x0020)!=0||(flags&0x0040)!=0||(flags&0x2000)!=0||(flags&~(0x0006|DATA_DESCRIPTOR_FLAG|UTF8_FLAG))!=0)
                throw invalid("Encrypted or unsupported ZIP entry flags are not allowed.");
            if(method!=ZipEntry.STORED&&method!=ZipEntry.DEFLATED)throw invalid("Only stored and deflated ZIP entries are supported.");
            int nameStart=cursor+46;require(zip,nameStart,nameLength+extraLength+commentLength);byte[] rawName=new byte[nameLength];System.arraycopy(zip,nameStart,rawName,0,nameLength);
            String name=decodeName(rawName,(flags&UTF8_FLAG)!=0);boolean directory=validatePath(name);validateExtras(zip,nameStart+nameLength,extraLength);
            if(!paths.add(pathKey(name)))throw invalid("The artifact contains duplicate or aliased paths.");
            validateAttributes(madeBy,external,directory);
            if(directory&&(size!=0||compressed!=0))throw invalid("Artifact directory entries must be empty.");
            if(method==ZipEntry.STORED&&compressed!=size)throw invalid("Stored ZIP entry sizes do not match.");
            if(local>=directoryOffset)throw invalid("A ZIP entry points into the central directory.");
            entries.add(new Entry(name,rawName,flags,method,compressed,size,crc,local,directory));
            cursor=nameStart+nameLength+extraLength+commentLength;
        }
        if(cursor!=end)throw invalid("The ZIP central directory contains unexpected data.");
        long previousEnd=0;for(int index=0;index<entries.size();index++){Entry entry=entries.get(index);if(index==0&&entry.localOffset!=0)throw invalid("Self-extracting ZIP archives are not supported.");if(entry.localOffset<previousEnd)throw invalid("ZIP entries overlap or are out of order.");previousEnd=validateLocalHeader(zip,entry,directoryOffset);}
        return entries;
    }

    private static long validateLocalHeader(byte[] zip,Entry entry,long directoryOffset)throws Exception{
        int offset=(int)entry.localOffset;require(zip,offset,30);if(u32(zip,offset)!=0x04034b50L)throw invalid("A ZIP local header is malformed.");
        int flags=u16(zip,offset+6),method=u16(zip,offset+8),nameLength=u16(zip,offset+26),extraLength=u16(zip,offset+28);long localCrc=u32(zip,offset+14),localCompressed=u32(zip,offset+18),localSize=u32(zip,offset+22);
        require(zip,offset+30,nameLength+extraLength);byte[] localName=new byte[nameLength];System.arraycopy(zip,offset+30,localName,0,nameLength);
        if(flags!=entry.flags||method!=entry.method||!java.util.Arrays.equals(localName,entry.rawName))throw invalid("ZIP local and central headers disagree.");
        validateExtras(zip,offset+30+nameLength,extraLength);
        if((flags&DATA_DESCRIPTOR_FLAG)==0){if(localCrc!=entry.crc||localCompressed!=entry.compressedSize||localSize!=entry.size)throw invalid("ZIP local and central sizes disagree.");}
        else if((localCompressed!=0&&localCompressed!=entry.compressedSize)||(localSize!=0&&localSize!=entry.size)||(localCrc!=0&&localCrc!=entry.crc))throw invalid("ZIP descriptor sizes disagree with the directory.");
        long dataEnd=(long)offset+30+nameLength+extraLength+entry.compressedSize;
        if(dataEnd>directoryOffset||dataEnd>Integer.MAX_VALUE)throw invalid("ZIP entry data is outside the archive.");
        if((flags&DATA_DESCRIPTOR_FLAG)!=0){int descriptor=(int)dataEnd;if(u32(zip,descriptor)==0x08074b50L)descriptor+=4;require(zip,descriptor,12);if(u32(zip,descriptor)!=entry.crc||u32(zip,descriptor+4)!=entry.compressedSize||u32(zip,descriptor+8)!=entry.size)throw invalid("ZIP data descriptor does not match its directory entry.");dataEnd=(long)descriptor+12;}
        if(dataEnd>directoryOffset)throw invalid("ZIP entry data overlaps its directory.");return dataEnd;
    }

    private static void validateAttributes(int madeBy,long external,boolean directory)throws Exception{
        int host=(madeBy>>>8)&0xff;
        if(host==3){int mode=(int)(external>>>16)&0xffff;int type=mode&0xf000;
            if((type!=0x8000&&type!=0x4000)||(directory!=(type==0x4000)))throw invalid("Links and non-regular ZIP entries are not allowed.");}
        else if(host==0){long dos=external&0xffffL;if((external>>>16)!=0||(dos&(0x08|0x40|0x400))!=0||(((dos&0x10)!=0)&&!directory))throw invalid("Special ZIP entries are not allowed.");}
        else throw invalid("The ZIP entry platform does not provide a supported regular-file type.");
    }

    private static void validateExtras(byte[] zip,int offset,int length)throws Exception{
        int end=offset+length;while(offset<end){require(zip,offset,4);int id=u16(zip,offset),size=u16(zip,offset+2);offset+=4;require(zip,offset,size);
            if(id==0x0001||id==0x7075||id==0x6375)throw invalid("ZIP64 or alternate-name fields are not supported.");offset+=size;}
        if(offset!=end)throw invalid("ZIP extra fields are malformed.");
    }

    private static boolean validatePath(String raw)throws Exception{
        if(raw==null||raw.isEmpty()||raw.startsWith("/")||raw.startsWith("\\")||raw.contains("\\")||raw.contains(":")||raw.contains("%")||!Normalizer.isNormalized(raw,Normalizer.Form.NFC))throw invalid("The artifact contains an unsafe path.");
        boolean directory=raw.endsWith("/");String path=directory?raw.substring(0,raw.length()-1):raw;
        if(path.isEmpty()||path.length()>1024)throw invalid("The artifact path is outside the supported length.");
        String[] parts=path.split("/",-1);for(String part:parts){if(part.isEmpty()||".".equals(part)||"..".equals(part)||part.length()>255||part.endsWith(".")||part.endsWith(" "))throw invalid("The artifact contains an unsafe path segment.");
            for(int i=0;i<part.length();i++)if(Character.isISOControl(part.charAt(i)))throw invalid("The artifact path contains a control character.");}
        return directory;
    }
    private static String pathKey(String name){String path=name.endsWith("/")?name.substring(0,name.length()-1):name;return Normalizer.normalize(path,Normalizer.Form.NFC).toLowerCase(Locale.ROOT);}

    private static String decodeName(byte[] bytes,boolean utf8)throws Exception{
        if(!utf8)for(byte value:bytes)if((value&0x80)!=0)throw invalid("Non-ASCII ZIP paths must use UTF-8 encoding.");
        try{return StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();}catch(CharacterCodingException error){throw invalid("The artifact contains an invalid UTF-8 path.");}
    }
    private static long u32(byte[] bytes,int offset)throws Exception{require(bytes,offset,4);return ((long)bytes[offset]&255)|(((long)bytes[offset+1]&255)<<8)|(((long)bytes[offset+2]&255)<<16)|(((long)bytes[offset+3]&255)<<24);}
    private static int u16(byte[] bytes,int offset)throws Exception{require(bytes,offset,2);return (bytes[offset]&255)|((bytes[offset+1]&255)<<8);}
    private static void require(byte[] bytes,int offset,int length)throws Exception{if(offset<0||length<0||offset>(long)bytes.length-length)throw invalid("The ZIP archive is truncated or malformed.");}
    private static SecurityException invalid(String message){return new SecurityException(message);}
}
