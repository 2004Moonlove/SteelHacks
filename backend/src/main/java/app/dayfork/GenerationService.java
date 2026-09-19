package app.dayfork;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.function.Consumer;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class GenerationService {
    private static final String SCENARIO_PROMPT = """
            Return one JSON object only. Build a monthly money-and-time comparison for exactly two options.
            Use this contract: {schemaVersion:1,id,title,description,originalInput,currency:"USD",options:[{id,name,fixedCosts:[{id,name,amountCentsMonthly:NumericField}],activities:[{id,name,eventUnit,frequencyInput?:{label,eventsPerUnit},eventsPerMonth:NumericField,costCentsPerEvent:NumericField,minutesPerEvent:NumericField}]}],tags:[Tag]}.
            NumericField is {value:nonnegative safe integer,source:"user_input"|"derived",note?:string} for explicitly supplied or deterministic values; otherwise {value:null,source:"unknown",note?:string}. Never guess numbers, and do not create demo assumptions.
            A missing value must always be {value:null,source:"unknown"}, even when a future calculation could derive it. Never pair null with user_input or derived. Omit unused optional fields instead of returning null or an empty string.
            eventUnit must be exactly one of "one_way_trip", "meal", "session", or "event". Use "session" for gym visits and "meal" for meals.
            Omit frequencyInput unless it is needed for a known unit conversion. Its eventsPerUnit is a plain positive integer, NOT a NumericField and NOT the number of visits per month. For example, {label:"Round trips",eventsPerUnit:2} converts each round trip to two one-way events. Unknown usage belongs in eventsPerMonth as {value:null,source:"unknown"}.
            Build the baseline BEFORE suggesting Tags. Include each option's unavoidable fixed charges even when their amounts are unknown. A gym membership needs a membership fee in fixedCosts for BOTH options; do not leave fixedCosts empty because the price was not supplied. Store the annual plan's monthly-equivalent fee there, never only as a per-visit fee. Other decisions may have only per-use costs when that matches how they are paid.
            Return 5 to 10 relevant Tags. Every Tag is {id,name,description,icon?:string,type,targets:[...]}. Allowed types and targets: fixed => {optionId,costCentsMonthly:NumericField,minutesMonthly:NumericField}; add_activity or reduce_activity => {optionId,activityId,eventsPerMonth:NumericField}; replace_activity => {optionId,activityId,replacementName,eventsPerMonth:NumericField,costCentsPerEvent:NumericField,minutesPerEvent:NumericField}.
            All referenced option and activity IDs must exist. Target arrays must be nonempty and contain no duplicate option/activity pair. Use stable short ASCII IDs. Costs are integer USD cents, time is integer minutes, and frequencies are integer events per month. Unknown means null, never zero. Confirmed zero is allowed only if clear from the input.
            Tags are optional, concrete changes to baseline behavior or spending, not comparison headings. Do not turn baseline membership fees, total cost, savings, commitment length, or abstract flexibility into extra fixed charges. Use actions such as additional sessions, fewer sessions, replacing a session, or an optional paid service. Include relevant baseline activities with unknown parameters when the user has not supplied their usage.
            Match every Tag to its exact arithmetic: fixed ADDS a recurring charge or tracked time; add_activity ADDS more events of the SAME baseline activity at its existing price and duration; reduce_activity REMOVES events; replace_activity swaps existing events for a DIFFERENT activity with its own cost and time. For example, coached workouts replace regular sessions; adding ordinary sessions cannot represent a new trainer fee. Moving an unchanged activity to morning or evening does not add events and is not a supported Tag. Suggest distinct concrete adjustments and keep editable frequencies out of Tag names.
            For annual versus monthly plans, clearly label an annual plan's fixed cost as its monthly equivalent and explain the yearly payment basis in its note. Keep unspecified prices unknown. Do not model contract duration as time spent, or cancellation/refund terms as recurring fees without supplied terms.
            An added activity must already exist in the option baseline. Replacement events consume original events of the same unit. Do not invent formulas or subjective scores. Make titles and descriptions English.
            """;
    private static final String STORY_PROMPT = """
            Return one JSON object only. Write two comparable English narratives for the exact same circumstances and aligned moments. Do not recommend a winner, assign feelings or outcomes, or introduce unconfigured paid/time-consuming events, traffic, weather, extra rides, meals, or activities.
            The input contains a validated simulation snapshot, a story context, and a fact inventory. Monthly figures belong to the full simulation; the day is illustrative. Use only the supplied facts for every numeric claim or clock time, formatted as {{factId}}. Do not write digits or spelled-out numeric claims directly in story text. Do not invent fact IDs. No markdown.
            Required JSON: {decisionId:<input decision.id>,simulationVersion:<input version>,sharedScenario:{title:string,description:string},moments:[{key:"morning",options:[{optionId:<first option id>,text:string},{optionId:<second option id>,text:string}]},{key:"daytime",options:[...]},{key:"evening",options:[...]}],monthlyReflections:[{optionId:<first option id>,text:string},{optionId:<second option id>,text:string}]}.
            Each text should be concise and grounded. Refer to supplied monthly totals in the reflections using fact placeholders. Keep corresponding moments parallel.
            """;

    private final ModelClient model;
    private final ObjectMapper mapper;
    private final ContractValidator contract;
    private final StoryValidator stories;

    public GenerationService(ModelClient model, ObjectMapper mapper, ContractValidator contract, StoryValidator stories) {
        this.model = model;
        this.mapper = mapper;
        this.contract = contract;
        this.stories = stories;
    }

    public JsonNode scenario(String description) {
        String trimmed = description == null ? "" : description.trim();
        if (trimmed.isEmpty() || trimmed.length() > 4000) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "Enter a decision description of up to 4,000 characters.",
                    List.of(new ApiException.FieldIssue("description", "A decision description is required.")));
        }
        return generate(SCENARIO_PROMPT, trimmed, output -> {
            if (output instanceof ObjectNode object) object.put("originalInput", trimmed);
            normalizeMissingGeneratedValues(output);
            contract.generatedDecision(output);
        });
    }

    private void normalizeMissingGeneratedValues(JsonNode node) {
        if (node instanceof ObjectNode object) {
            String source = object.path("source").asText();
            if (object.path("value").isNull() && (source.equals("derived") || source.equals("user_input"))) {
                // An absent number cannot be known, even when the model labels it as derived.
                object.put("source", "unknown");
            }
            object.elements().forEachRemaining(this::normalizeMissingGeneratedValues);
        } else if (node != null && node.isArray()) {
            node.elements().forEachRemaining(this::normalizeMissingGeneratedValues);
        }
    }

    public JsonNode story(JsonNode request) {
        try {
            stories.request(request);
        } catch (ContractValidator.ContractException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "The story request is invalid.",
                    List.of(new ApiException.FieldIssue(exception.path(), exception.getMessage())));
        }
        return generate(STORY_PROMPT, serialize(request), output -> stories.response(output, request));
    }

    private JsonNode generate(String systemPrompt, String input, Consumer<JsonNode> validator) {
        String output = model.complete(List.of(
                new ModelClient.Message("system", systemPrompt),
                new ModelClient.Message("user", input)));
        try {
            return parseAndValidate(output, validator);
        } catch (ContractValidator.ContractException firstError) {
            String repair = "The previous JSON failed validation at " + firstError.path() + ": "
                    + firstError.getMessage() + ". Return a complete corrected JSON object only. Previous output: "
                    + output.substring(0, Math.min(output.length(), 20_000));
            String repaired = model.complete(List.of(
                    new ModelClient.Message("system", systemPrompt),
                    new ModelClient.Message("user", input),
                    new ModelClient.Message("assistant", output),
                    new ModelClient.Message("user", repair)));
            try {
                return parseAndValidate(repaired, validator);
            } catch (ContractValidator.ContractException secondError) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "MODEL_OUTPUT_INVALID",
                        "The model returned an invalid result. Please retry.",
                        List.of(new ApiException.FieldIssue(secondError.path(), secondError.getMessage())));
            }
        }
    }

    private JsonNode parseAndValidate(String output, Consumer<JsonNode> validator) {
        try {
            JsonNode parsed = mapper.readTree(output);
            validator.accept(parsed);
            return parsed;
        } catch (JsonProcessingException exception) {
            throw new ContractValidator.ContractException("model", "Response is not valid JSON.");
        }
    }

    private String serialize(JsonNode value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "The request could not be serialized.");
        }
    }
}
