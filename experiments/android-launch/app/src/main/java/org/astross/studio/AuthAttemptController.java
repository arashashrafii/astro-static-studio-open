package org.astross.studio;

/** Tracks one active Device Flow attempt and fences all late results after cancel/retry. */
final class AuthAttemptController {
    private final AuthGeneration generation;
    private long activeTicket;
    AuthAttemptController(AuthGeneration generation){this.generation=generation;}
    synchronized long begin(){if(activeTicket!=0)return -1;activeTicket=generation.advance();return activeTicket;}
    synchronized void cancel(){generation.advance();activeTicket=0;}
    synchronized void finish(long ticket){if(activeTicket==ticket)activeTicket=0;}
    long current(){return generation.current();}
    boolean isCurrent(long ticket){return generation.isCurrent(ticket);}
    boolean runIfCurrent(long ticket,AuthGeneration.Action action)throws Exception{return generation.runIfCurrent(ticket,action);}
    AuthGeneration generation(){return generation;}
}
