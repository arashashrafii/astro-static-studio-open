package org.astross.studio;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class AuthAttemptControllerTest {
    @Test public void cancelReleasesAttemptImmediatelyAndRejectsLateBlockedSave()throws Exception{
        AuthAttemptController attempts=new AuthAttemptController(new AuthGeneration());ExecutorService workers=Executors.newCachedThreadPool();
        CountDownLatch requestStarted=new CountDownLatch(1),releaseOldRequest=new CountDownLatch(1);
        List<String> saved=Collections.synchronizedList(new ArrayList<>());
        try{
            long old=attempts.begin();Future<Boolean> stale=workers.submit(()->{requestStarted.countDown();
                if(!releaseOldRequest.await(5,TimeUnit.SECONDS))throw new AssertionError("Simulated GitHub request timed out");
                boolean wrote=attempts.runIfCurrent(old,()->saved.add("stale"));attempts.finish(old);return wrote;});
            assertTrue(requestStarted.await(5,TimeUnit.SECONDS));
            attempts.cancel();long retry=attempts.begin();assertTrue("Retry must reserve a new attempt immediately",retry>old);
            assertTrue(attempts.runIfCurrent(retry,()->saved.add("current")));releaseOldRequest.countDown();
            assertFalse(stale.get(5,TimeUnit.SECONDS));assertEquals(Collections.singletonList("current"),saved);
        }finally{releaseOldRequest.countDown();workers.shutdownNow();}
    }
    @Test public void activeAttemptRejectsDuplicateStartUntilFinished(){
        AuthAttemptController attempts=new AuthAttemptController(new AuthGeneration());long first=attempts.begin();
        assertTrue(first>0);assertEquals(-1,attempts.begin());attempts.finish(first);assertTrue(attempts.begin()>first);
    }
}
