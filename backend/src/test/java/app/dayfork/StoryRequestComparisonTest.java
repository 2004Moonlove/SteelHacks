package app.dayfork;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

class StoryRequestComparisonTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));

    @ParameterizedTest
    @ValueSource(strings = {"general", "campus"})
    void acceptsActualFrontendRequestsAndComparisonReferences(String mode) throws Exception {
        JsonNode request = frontendRequest(mode);
        String response = """
            {"decisionId":"campus-housing-demo","simulationVersion":1,
             "sharedScenario":{"title":"A shared day","description":"The same plan applies to each home."},
             "moments":[
               {"key":"morning","options":[{"optionId":"near","text":"The day begins."},{"optionId":"far","text":"The day begins."}]},
               {"key":"daytime","options":[{"optionId":"near","text":"The plan continues."},{"optionId":"far","text":"The plan continues."}]},
               {"key":"evening","options":[{"optionId":"near","text":"The evening arrives."},{"optionId":"far","text":"The evening arrives."}]}
             ],
             "monthlyReflections":[
               {"optionId":"near","text":"{{monthlyCostComparison}}"},
               {"optionId":"far","text":"{{monthlyTimeComparison}}"}
             ]}
            """;
        int[] calls = {0};
        ModelClient model = new ModelClient() {
            @Override
            public String complete(List<Message> messages) {
                calls[0]++;
                return response;
            }

            @Override
            public boolean configured() { return true; }
        };
        GenerationService service = new GenerationService(model, mapper, contract, validator);

        JsonNode story = service.story(request);

        assertEquals("campus-housing-demo", story.path("decisionId").asText());
        assertEquals(1, calls[0]);
    }

    @ParameterizedTest
    @MethodSource("directions")
    void acceptsEachCostAndTimeDirectionInBothModes(String mode, int costDelta, int timeDelta,
            String costComparison, String timeComparison) throws Exception {
        ObjectNode request = directionRequest(mode, costDelta, timeDelta);
        ObjectNode facts = (ObjectNode) request.path("facts");
        facts.put("monthlyCostComparison", costComparison);
        facts.put("monthlyTimeComparison", timeComparison);

        assertDoesNotThrow(() -> validator.request(request));
    }

    private static Stream<Arguments> directions() {
        int[] costs = {-25000, 0, 25000};
        int[] times = {-60, 0, 60};
        String[] costFacts = {
                "Near campus costs $250.00 more per month than Farther away.",
                "Near campus and Farther away have equal monthly cost.",
                "Farther away costs $250.00 more per month than Near campus."};
        String[] timeFacts = {
                "Near campus uses 1 hr 0 min more per month than Farther away.",
                "Near campus and Farther away use equal monthly time.",
                "Farther away uses 1 hr 0 min more per month than Near campus."};
        Stream.Builder<Arguments> cases = Stream.builder();
        for (String mode : List.of("general", "campus")) {
            for (int cost = 0; cost < costs.length; cost++) {
                for (int time = 0; time < times.length; time++) {
                    cases.add(Arguments.of(mode, costs[cost], times[time], costFacts[cost], timeFacts[time]));
                }
            }
        }
        return cases.build();
    }

    @ParameterizedTest
    @ValueSource(strings = {"general", "campus"})
    void preservesLegacyRequestsWithoutComparisonPair(String mode) throws Exception {
        ObjectNode request = frontendRequest(mode);
        ((ObjectNode) request.path("facts")).remove(List.of("monthlyCostComparison", "monthlyTimeComparison"));

        assertDoesNotThrow(() -> validator.request(request));
    }

    @ParameterizedTest
    @ValueSource(strings = {"general", "campus"})
    void rejectsReversedDirectionsAndForgedAmounts(String mode) throws Exception {
        String[][] forgeries = {
                {"monthlyCostComparison", "Farther away costs $250.00 more per month than Near campus."},
                {"monthlyCostComparison", "Near campus costs $1.00 more per month than Farther away."},
                {"monthlyCostComparison", "Near campus and Farther away have equal monthly cost."},
                {"monthlyTimeComparison", "Near campus uses 18 hr 0 min more per month than Farther away."},
                {"monthlyTimeComparison", "Farther away uses 1 hr 0 min more per month than Near campus."},
                {"monthlyTimeComparison", "Near campus and Farther away use equal monthly time."}};
        for (String[] forgery : forgeries) {
            ObjectNode request = frontendRequest(mode);
            ((ObjectNode) request.path("facts")).put(forgery[0], forgery[1]);

            ContractValidator.ContractException error = assertThrows(ContractValidator.ContractException.class,
                    () -> validator.request(request));
            assertEquals("facts." + forgery[0], error.path());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"general", "campus"})
    void rejectsIncompleteComparisonPairs(String mode) throws Exception {
        for (String missing : List.of("monthlyCostComparison", "monthlyTimeComparison")) {
            ObjectNode request = frontendRequest(mode);
            ((ObjectNode) request.path("facts")).remove(missing);

            ContractValidator.ContractException error = assertThrows(ContractValidator.ContractException.class,
                    () -> validator.request(request));
            assertEquals("facts." + missing, error.path());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"general", "campus"})
    void stillRejectsArbitraryFacts(String mode) throws Exception {
        ObjectNode request = frontendRequest(mode);
        ((ObjectNode) request.path("facts")).put("inventedComparison", "Farther away is better.");

        ContractValidator.ContractException error = assertThrows(ContractValidator.ContractException.class,
                () -> validator.request(request));
        assertEquals("facts.inventedComparison", error.path());
    }

    private ObjectNode frontendRequest(String mode) throws IOException {
        try (var stream = getClass().getResourceAsStream("/story-" + mode + "-request.json")) {
            return (ObjectNode) mapper.readTree(stream);
        }
    }

    private ObjectNode directionRequest(String mode, int costDelta, int timeDelta) throws IOException {
        ObjectNode request = frontendRequest(mode);
        ObjectNode snapshot = (ObjectNode) request.path("snapshot");
        ObjectNode decision = (ObjectNode) snapshot.path("decision");
        snapshot.putArray("enabledTagIds");
        decision.putArray("tags");
        var options = decision.putArray("options");
        ObjectNode calculation = snapshot.putObject("calculation");
        calculation.put("status", "valid");
        var results = calculation.putArray("options");
        calculation.putObject("comparison").put("costDeltaCents", costDelta).put("timeDeltaMinutes", timeDelta);
        ObjectNode facts = request.putObject("facts");
        facts.put("monthlyCostDifference", money(Math.abs(costDelta)));
        facts.put("monthlyTimeDifference", duration(Math.abs(timeDelta)));
        ObjectNode context = request.putObject("context");
        context.put("mode", mode);
        var selections = mapper.createArrayNode();
        for (int i = 0; i < 2; i++) {
            String id = i == 0 ? "near" : "far";
            String name = i == 0 ? "Near campus" : "Farther away";
            String prefix = i == 0 ? "optionA" : "optionB";
            int cost = 150000 + (i == 0 ? 0 : costDelta);
            int minutes = 120 + (i == 0 ? 0 : timeDelta);
            ObjectNode option = options.addObject().put("id", id).put("name", name);
            option.putArray("fixedCosts").addObject().put("id", "rent").put("name", "Rent")
                    .putObject("amountCentsMonthly").put("value", cost).put("source", "user_input");
            ObjectNode activity = option.putArray("activities").addObject()
                    .put("id", "commute").put("name", "Commute").put("eventUnit", "one_way_trip");
            activity.putObject("eventsPerMonth").put("value", 2).put("source", "user_input");
            activity.putObject("costCentsPerEvent").put("value", 0).put("source", "user_input");
            activity.putObject("minutesPerEvent").put("value", minutes / 2).put("source", "user_input");
            ObjectNode result = results.addObject().put("optionId", id).put("totalCostCents", cost).put("totalTimeMinutes", minutes);
            var breakdown = result.putArray("breakdown");
            breakdown.addObject().put("id", id + ":rent:fixed").put("kind", "baseline_fixed").put("label", "Rent")
                    .put("totalCostCents", cost).put("totalTimeMinutes", 0);
            breakdown.addObject().put("id", id + ":commute:original").put("kind", "original_activity").put("label", "Commute")
                    .put("activityId", "commute").put("eventsPerMonth", 2).put("costCentsPerEvent", 0).put("minutesPerEvent", minutes / 2)
                    .put("totalCostCents", 0).put("totalTimeMinutes", minutes);
            facts.put(prefix + "_name", name).put(prefix + "_monthlyCost", money(cost)).put(prefix + "_monthlyTime", duration(minutes));
            if (mode.equals("campus")) {
                selections.addObject().put("optionId", id).put("activityId", "commute")
                        .put("outboundChoiceId", "original:commute").put("inboundChoiceId", "original:commute");
                facts.put(prefix + "_leaveHome", clock(9 * 60 - minutes / 2));
                facts.put(prefix + "_arriveCampus", "9:00 AM");
                facts.put(prefix + "_leaveCampus", "5:00 PM");
                facts.put(prefix + "_arriveHome", clock(17 * 60 + minutes / 2));
                facts.put(prefix + "_outboundMode", "Commute");
                facts.put(prefix + "_inboundMode", "Commute");
                facts.put(prefix + "_dayTravelCost", "$0.00");
                facts.put(prefix + "_dayTravelTime", duration(minutes));
            }
        }
        if (mode.equals("campus")) {
            context.put("arrivalTime", "09:00").put("departureTime", "17:00").set("selections", selections);
        }
        return request;
    }

    private String money(int cents) {
        return String.format(Locale.US, "$%,d.%02d", cents / 100, cents % 100);
    }

    private String duration(int minutes) {
        return (minutes / 60) + " hr " + (minutes % 60) + " min";
    }

    private String clock(int minutes) {
        return String.format(Locale.US, "%d:%02d %s", minutes / 60 % 12, minutes % 60, minutes < 720 ? "AM" : "PM");
    }
}
