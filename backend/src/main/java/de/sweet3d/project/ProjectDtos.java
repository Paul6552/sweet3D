package de.sweet3d.project;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class ProjectDtos {

    private ProjectDtos() {
    }

    public record ProjectSummary(UUID id, String name, Instant createdAt, Instant updatedAt, long version) {
        static ProjectSummary of(Project p) {
            return new ProjectSummary(p.id, p.name, p.createdAt, p.updatedAt, p.version);
        }
    }

    public record ProjectDetail(UUID id, String name, Instant createdAt, Instant updatedAt, long version, JsonNode home) {
        static ProjectDetail of(Project p) {
            return new ProjectDetail(p.id, p.name, p.createdAt, p.updatedAt, p.version, p.home);
        }
    }

    public record CreateProject(@NotBlank @Size(max = 255) String name) {
    }

    /** Änderung eines Projekts; {@code version} muss dem zuletzt gelesenen Stand entsprechen. */
    public record UpdateProject(@Size(min = 1, max = 255) String name, JsonNode home, @NotNull Long version) {
    }
}
