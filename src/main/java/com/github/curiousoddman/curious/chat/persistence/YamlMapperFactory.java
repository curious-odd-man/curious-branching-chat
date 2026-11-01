package com.github.curiousoddman.curious.chat.persistence;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fasterxml.jackson.dataformat.yaml.YAMLGenerator;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import static com.fasterxml.jackson.core.JsonGenerator.Feature.WRITE_BIGDECIMAL_AS_PLAIN;

/**
 * Builds the single {@link ObjectMapper} configuration used to read/write every design YAML slot
 * file (§1.2: "YAML is the default textual data format for design/group files").
 * <p>
 * Domain model classes (§1.3) are plain mutable POJOs (conventional getter/setter pairs) plus a
 * handful of records for small immutable value types — both are handled by Jackson's standard bean
 * introspection with no special visibility configuration needed. Records are matched to their
 * canonical constructor automatically; POJOs go through their public getters/setters.
 */
@Configuration
public class YamlMapperFactory {

    @Bean
    public ObjectMapper yamlMapper() {
        YAMLFactory yamlFactory = YAMLFactory.builder()
                                             .disable(YAMLGenerator.Feature.WRITE_DOC_START_MARKER)
                                             .enable(YAMLGenerator.Feature.MINIMIZE_QUOTES)
                                             .build();

        ObjectMapper mapper = new ObjectMapper(yamlFactory);

        mapper.registerModule(new JavaTimeModule());

        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        mapper.enable(SerializationFeature.INDENT_OUTPUT);
        // BigDecimal (Design.millimetersPerUnit and friends) as plain "0.5", never "5E-1"
        mapper.enable(WRITE_BIGDECIMAL_AS_PLAIN);

        return mapper;
    }
}
