package app.dayfork;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.util.ArrayList;
import org.junit.jupiter.api.Test;

class StoryRequestBoundaryTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));

    @Test
    void acceptsExactFrontendFactsForLongNamesAndMaximumSafeAmounts() throws Exception {
        ObjectNode request = request();
        assertTrue(request.path("facts").path("monthlyCostComparison").asText().length() > 200);
        assertEquals("$90,071,992,547,409.91", request.path("facts").path("optionA_monthlyCost").asText());
        assertDoesNotThrow(() -> validator.request(request));
    }

    @Test
    void acceptsDerivedFactsContainingTwoMaximumLengthOptionNames() throws Exception {
        ObjectNode request = request();
        replaceOptionNames(request, "A".repeat(ContractValidator.MAX_TEXT_LENGTH), "B".repeat(ContractValidator.MAX_TEXT_LENGTH));
        assertTrue(request.path("facts").path("monthlyCostComparison").asText().length() > ContractValidator.MAX_TEXT_LENGTH);
        assertDoesNotThrow(() -> validator.request(request));
    }

    @Test
    void stillRejectsAlteredFactsAndLostCents() throws Exception {
        for (String key : new String[] {"monthlyCostComparison", "optionA_monthlyCost"}) {
            ObjectNode request = request();
            ObjectNode facts = (ObjectNode) request.path("facts");
            facts.put(key, key.equals("optionA_monthlyCost") ? "$90,071,992,547,409.90" : facts.path(key).asText() + " Altered.");
            var error = assertThrows(ContractValidator.ContractException.class, () -> validator.request(request));
            assertEquals("facts." + key, error.path());
        }
    }

    private ObjectNode request() throws IOException {
        try (var stream = getClass().getResourceAsStream("/story-boundaries-request.json")) {
            return (ObjectNode) mapper.readTree(stream);
        }
    }

    private void replaceOptionNames(ObjectNode request, String first, String second) {
        var options = request.path("snapshot").path("decision").path("options");
        String oldFirst = options.get(0).path("name").asText();
        String oldSecond = options.get(1).path("name").asText();
        ((ObjectNode) options.get(0)).put("name", first);
        ((ObjectNode) options.get(1)).put("name", second);
        ObjectNode facts = (ObjectNode) request.path("facts");
        var keys = new ArrayList<String>();
        facts.fieldNames().forEachRemaining(keys::add);
        for (String key : keys) facts.put(key, facts.path(key).asText().replace(oldFirst, first).replace(oldSecond, second));
    }
}
