package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class StoryMoneyNormalizationTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));
    private final StoryDraftAssembler assembler = new StoryDraftAssembler(mapper, contract);

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {"$600,|{{optionA_payment}},", "$600.00|{{optionA_payment}}", "$1,200|{{optionA_totalCost}}", "$1200.00|{{optionA_totalCost}}"})
    void convertsOnlyExactUniqueMoneyFactsToCanonicalReferences(String literal, String expected) throws Exception {
        ObjectNode request = request();
        validator.request(request);
        ObjectNode draft = draft("You pay " + literal + " under the stated arrangement.");
        JsonNode original = draft.deepCopy();
        JsonNode story = assembler.assemble(draft, request);
        validator.response(story, request);
        assertEquals("You pay " + expected + " under the stated arrangement.", story.path("moments").get(0).path("options").get(0).path("text").asText());
        assertEquals(original, draft);
    }

    @ParameterizedTest
    @ValueSource(strings = {"$601", "$600.01", "$600.001", "$6,00", "$600k", "$600%", "-$600", "600", "13 months"})
    void stillRejectsUnsupportedAmountsMalformedAmountsAndOrdinaryNumericClaims(String literal) throws Exception {
        ObjectNode request = request();
        JsonNode story = assembler.assemble(draft("You pay " + literal + " under the stated arrangement."), request);
        assertThrows(ContractValidator.ContractException.class, () -> validator.response(story, request));
    }

    @Test
    void doesNotChooseBetweenMultipleFactIdsWithTheSameAmountOrUseAnOptionNameAsMoney() throws Exception {
        ObjectNode story = (ObjectNode) assembler.assemble(draft("You pay $600 under the stated arrangement."), request());
        ((ObjectNode) story.path("moments").get(0).path("options").get(0)).put("text", "You pay $600 under the stated arrangement.");
        ObjectNode facts = mapper.createObjectNode().put("optionA_payment", "$600.00").put("optionB_payment", "$600.00");
        assertEquals(story, StoryMoneyNormalizer.normalize(story, facts));
        facts.removeAll();
        facts.put("optionA_name", "$600.00").put("subscriptionCostComparison", "Both plans cost $600.00.");
        assertEquals(story, StoryMoneyNormalizer.normalize(story, facts));
    }

    @Test
    void repairsTheObservedKnownDollarFormattingWithoutAnotherModelCall() throws Exception {
        ObjectNode request = request();
        List<List<ModelClient.Message>> calls = new ArrayList<>();
        String output = mapper.writeValueAsString(draft("You pay $600, then start the selected arrangement."));
        ModelClient model = new ModelClient() {
            @Override public String complete(List<Message> messages) { calls.add(List.copyOf(messages)); return output; }
            @Override public boolean configured() { return true; }
        };
        JsonNode story = new GenerationService(model, mapper, contract, validator).story(request);
        assertEquals(1, calls.size());
        assertTrue(story.path("moments").get(0).path("options").get(0).path("text").asText().contains("{{optionA_payment}},"));
        assertEquals(request().path("facts"), request.path("facts"));
    }

    private ObjectNode request() throws Exception {
        try (var stream = getClass().getResourceAsStream("/story-subscription-request.json")) { return (ObjectNode) mapper.readTree(stream); }
    }

    private ObjectNode draft(String beginning) {
        ObjectNode draft = mapper.createObjectNode();
        draft.putObject("sharedScenario").put("title", "A possible shared routine").put("description", "Imagine a shared change in schedule while either arrangement continues.");
        for (String key : List.of("optionA", "optionB")) {
            ObjectNode option = draft.putObject(key);
            option.put("beginning", key.equals("optionA") ? beginning : "You begin the selected arrangement.");
            option.put("during", "If the shared schedule changes, you adjust when to use the service while access continues.");
            option.put("later", "As that routine develops, you prepare for the next applicable renewal.");
            option.put("advice", "Record the actual renewal and notice terms before choosing this arrangement.");
        }
        return draft;
    }
}
