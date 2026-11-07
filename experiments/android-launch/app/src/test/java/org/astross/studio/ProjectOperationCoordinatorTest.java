package org.astross.studio;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

public final class ProjectOperationCoordinatorTest {
    @Test public void refusesOverlappingProjectOperations()throws Exception{
        ProjectOperationCoordinator gate=new ProjectOperationCoordinator(new AuthAttemptController(new AuthGeneration()));
        long first=gate.begin();assertTrue(gate.isCurrent(first));assertEquals(-1,gate.begin());gate.finish(first);
        long next=gate.begin();assertTrue(next>first);gate.finish(next);
    }

    @Test public void logoutWaitsForBlockedWriteBeforeReportingCompletion()throws Exception{
        ProjectOperationCoordinator gate=new ProjectOperationCoordinator(new AuthAttemptController(new AuthGeneration()));
        long ticket=gate.begin();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),logoutStarted=new CountDownLatch(1),logoutDone=new CountDownLatch(1);
        List<String> events=Collections.synchronizedList(new ArrayList<>());
        Thread write=new Thread(()->{try{gate.run(ticket,()->{entered.countDown();if(!release.await(3,TimeUnit.SECONDS))throw new IllegalStateException("test timeout");events.add("put-complete");return null;});}catch(Exception ignored){}});
        write.start();assertTrue(entered.await(2,TimeUnit.SECONDS));
        Thread logout=new Thread(()->{logoutStarted.countDown();try{gate.cancelAndRunCleanup(()->{events.add("signed-out");return null;});}catch(Exception error){throw new AssertionError(error);}finally{logoutDone.countDown();}});
        logout.start();assertTrue(logoutStarted.await(2,TimeUnit.SECONDS));long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);while(gate.isCurrent(ticket)&&System.nanoTime()<deadline)Thread.yield();assertFalse(gate.isCurrent(ticket));assertFalse(logoutDone.await(100,TimeUnit.MILLISECONDS));
        release.countDown();write.join(2000);logout.join(2000);assertTrue(logoutDone.getCount()==0);
        assertEquals(List.of("put-complete","signed-out"),events);
    }
}
