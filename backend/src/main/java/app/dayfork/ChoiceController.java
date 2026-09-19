package app.dayfork;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
@RequestMapping("/api/choices")
public class ChoiceController {
    private final ChoiceService service;
    public ChoiceController(ChoiceService service) { this.service = service; }
    @PostMapping("/understand") public JsonNode understand(@RequestBody JsonNode body) { return service.understand(body); }
    @PostMapping("/factors") public JsonNode factors(@RequestBody JsonNode body) { return service.factors(body); }
    @PostMapping("/materials") public JsonNode materials(@RequestBody JsonNode body) { return service.materials(body); }
}
