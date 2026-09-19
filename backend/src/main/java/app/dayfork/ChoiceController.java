package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/choices")
public class ChoiceController {
    private final ChoiceService choices;

    public ChoiceController(ChoiceService choices) { this.choices = choices; }

    @PostMapping("/generate")
    public JsonNode generate(@RequestBody JsonNode request) { return choices.generate(request); }

    @PostMapping("/factors")
    public JsonNode factors(@RequestBody JsonNode request) { return choices.factors(request); }

    @PostMapping("/materials")
    public JsonNode materials(@RequestBody JsonNode request) { return choices.materials(request); }
}
