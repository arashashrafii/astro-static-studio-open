package org.astross.studio;

final class AuthGeneration {
    interface Action { void run() throws Exception; }
    private long current;
    synchronized long advance() { return ++current; }
    synchronized long current() { return current; }
    synchronized boolean isCurrent(long ticket) { return current == ticket; }
    synchronized boolean runIfCurrent(long ticket, Action action) throws Exception {
        if (current != ticket) return false;
        action.run();
        return true;
    }
}
