package me.parallel;

import java.util.List;

public interface ModelClient {
    String complete(List<Message> messages);
    boolean configured();

    record Message(String role, String content) {}
}
