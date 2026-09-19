package me.parallel;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiErrorHandler {
    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> handleApi(ApiException exception) {
        return ResponseEntity.status(exception.status()).body(Map.of(
                "code", exception.code(),
                "message", exception.getMessage(),
                "issues", exception.issues()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException exception) {
        List<ApiException.FieldIssue> issues = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> new ApiException.FieldIssue(error.getField(), error.getDefaultMessage()))
                .toList();
        return ResponseEntity.badRequest().body(Map.of(
                "code", "INVALID_REQUEST", "message", "Please correct the highlighted fields.", "issues", issues));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, Object>> handleUnreadable() {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                "code", "INVALID_REQUEST", "message", "The request body is not valid JSON.", "issues", List.of()));
    }
}
