package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class HousingCoverageTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();

    @Test
    void requiresBroadCampusHousingToOfferBothKindsOfRelevantFactors() throws Exception {
        ObjectNode decision = decision("Should I live on-campus or off-campus?");
        var exception = assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(decision));
        assertEquals("decision.tags", exception.path());
        assertTrue(exception.getMessage().contains("8 to 10"));
        addConsiderations(decision, 8 - decision.path("tags").size());
        contract.generatedDecision(decision);
    }

    @Test
    void aLongNumericalListDoesNotReplaceQualitativeLivingConcerns() throws Exception {
        ObjectNode decision = decision("I am renting: should I live off campus or on campus?");
        ArrayNode tags = (ArrayNode) decision.path("tags");
        while (tags.size() < 8) tags.add(((ObjectNode) tags.get(0).deepCopy()).put("id", "numeric-" + tags.size()));
        assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(decision));
    }

    @ParameterizedTest
    @ValueSource(strings = {"Should I live on campus or off campus? Only compare these two factors.",
            "Should I live on campus or off campus? Focus on commuting.",
            "Should I commute on campus or off campus by bike?", "Compare two monthly gym memberships."})
    void doesNotApplyAHousingQuotaToNarrowedOrUnrelatedQuestions(String input) throws Exception {
        ObjectNode decision = decision(input);
        contract.generatedDecision(decision);
    }

    @Test
    void loadingAnOlderSparseHousingScenarioRemainsValid() throws Exception {
        contract.decision(decision("Should I live on campus or off campus?"));
    }

    private ObjectNode decision(String input) throws Exception {
        try (var stream = getClass().getResourceAsStream("/story-general-request.json")) {
            ObjectNode decision = (ObjectNode) mapper.readTree(stream).path("snapshot").path("decision");
            decision.put("schemaVersion", 2).put("comparisonMode", "quantitative").put("originalInput", input);
            asGeneratedFields(decision);
            return decision;
        }
    }

    private void asGeneratedFields(JsonNode node) {
        if (node instanceof ObjectNode field && field.has("value") && field.has("source")) {
            if (!field.path("value").isNull()) field.put("source", "user_input");
            field.remove("confirmed");
        }
        node.elements().forEachRemaining(this::asGeneratedFields);
    }

    private void addConsiderations(ObjectNode decision, int count) {
        String[] names = {"Privacy", "Social connection", "Noise", "Independence", "Flexibility", "Shared space", "Daily routine", "Visitors"};
        ArrayNode tags = (ArrayNode) decision.path("tags");
        for (int i = 0; i < count; i++) {
            ObjectNode tag = tags.addObject().put("id", "living-" + i).put("name", names[i]).put("description", "Explore this living concern.").put("type", "consideration");
            tag.putArray("targets").addObject().put("optionId", "near").put("consideration", "If this living concern matters, imagine how your routine could adapt to this arrangement.");
        }
    }
}
