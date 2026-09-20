package app.dayfork;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;

final class GenerationContract {
    private static final String SCHEMA = loadSchema();

    private GenerationContract() {}

    static String systemPromptSuffix() {
        return "\nFollow this JSON Schema for the complete decision object. It is generated from the application's validator. "
                + "Return the decision, not the schema. Do not add keys where additionalProperties is false. "
                + "Omit optional fields when unused. Cross-field references and the semantic rules above still apply.\n"
                + SCHEMA;
    }

    private static String loadSchema() {
        try (var stream = GenerationContract.class.getResourceAsStream("/decision-generation.schema.json")) {
            if (stream == null) throw new IOException("Missing decision generation contract.");
            ObjectMapper mapper = new ObjectMapper();
            return mapper.writeValueAsString(mapper.readTree(stream));
        } catch (IOException exception) {
            throw new IllegalStateException("The decision generation contract could not be loaded.", exception);
        }
    }
}
