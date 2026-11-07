package org.astross.studio;

/** Serializes one project operation at a time and makes sign-out wait for in-flight network mutations. */
final class ProjectOperationCoordinator {
    interface Work<T>{T run()throws Exception;}
    private final AuthAttemptController attempts;
    private final Object operationLock=new Object();
    private volatile boolean closing;
    ProjectOperationCoordinator(AuthAttemptController attempts){this.attempts=attempts;}
    long begin(){if(closing)return -1;return attempts.begin();}
    boolean isCurrent(long ticket){return !closing&&attempts.isCurrent(ticket);}
    void finish(long ticket){attempts.finish(ticket);}
    GithubProjectClient.RequestGuard requestGuard(long ticket){return ()->isCurrent(ticket);}
    <T>T run(long ticket,Work<T> work)throws Exception{
        synchronized(operationLock){if(!isCurrent(ticket))throw new IllegalStateException("GitHub operation was cancelled.");return work.run();}
    }
    void cancelAndRunCleanup(Work<Void> cleanup)throws Exception{
        closing=true;attempts.cancel();
        synchronized(operationLock){try{cleanup.run();}finally{closing=false;}}
    }
}
