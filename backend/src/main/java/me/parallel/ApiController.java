package me.parallel;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final GenerationService generation;
    private final ModelClient model;

    public ApiController(GenerationService generation, ModelClient model) {
        this.generation = generation;
        this.model = model;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ready", "modelConfigured", model.configured());
    }

    @PostMapping("/scenarios/generate")
    public JsonNode scenario(@RequestBody JsonNode request) {
        String description = request != null && request.path("description").isTextual()
                ? request.path("description").asText() : "";
        return generation.scenario(description);
    }

    @PostMapping("/stories/generate")
    public JsonNode story(@RequestBody JsonNode request) {
        return generation.story(request);
    }
}
