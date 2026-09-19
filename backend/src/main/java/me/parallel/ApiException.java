package me.parallel;

import java.util.List;
import org.springframework.http.HttpStatus;

public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;
    private final List<FieldIssue> issues;

    public ApiException(HttpStatus status, String code, String message) {
        this(status, code, message, List.of());
    }

    public ApiException(HttpStatus status, String code, String message, List<FieldIssue> issues) {
        super(message);
        this.status = status;
        this.code = code;
        this.issues = issues;
    }

    public HttpStatus status() { return status; }
    public String code() { return code; }
    public List<FieldIssue> issues() { return issues; }

    public record FieldIssue(String path, String message) {}
}
