package de.sweet3d.project;

import com.fasterxml.jackson.databind.ObjectMapper;
import de.sweet3d.project.ProjectDtos.CreateProject;
import de.sweet3d.project.ProjectDtos.ProjectDetail;
import de.sweet3d.project.ProjectDtos.ProjectSummary;
import de.sweet3d.project.ProjectDtos.UpdateProject;
import de.sweet3d.security.CurrentUser;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Path("/api/projects")
public class ProjectResource {

    @Inject
    CurrentUser currentUser;

    @Inject
    ObjectMapper objectMapper;

    @GET
    public List<ProjectSummary> list() {
        return Project.listByOwner(currentUser.subject()).stream().map(ProjectSummary::of).toList();
    }

    @GET
    @Path("/{id}")
    public ProjectDetail get(UUID id) {
        return ProjectDetail.of(load(id));
    }

    @POST
    @Transactional
    public Response create(@Valid CreateProject request) {
        Project project = new Project();
        project.id = UUID.randomUUID();
        project.ownerSub = currentUser.subject();
        project.name = request.name().strip();
        project.home = objectMapper.createObjectNode();
        project.createdAt = Instant.now();
        project.updatedAt = project.createdAt;
        project.persistAndFlush();
        return Response.status(Response.Status.CREATED).entity(ProjectDetail.of(project)).build();
    }

    @PUT
    @Path("/{id}")
    @Transactional
    public ProjectDetail update(UUID id, @Valid UpdateProject request) {
        Project project = load(id);
        if (project.version != request.version()) {
            throw new ClientErrorException("Das Projekt wurde zwischenzeitlich geändert", Response.Status.CONFLICT);
        }
        if (request.name() != null) {
            project.name = request.name().strip();
        }
        if (request.home() != null) {
            project.home = request.home();
        }
        project.updatedAt = Instant.now();
        project.flush();
        return ProjectDetail.of(project);
    }

    @DELETE
    @Path("/{id}")
    @Transactional
    public void delete(UUID id) {
        load(id).delete();
    }

    /** Lädt ein Projekt des angemeldeten Nutzers; fremde Projekte sind wie nicht vorhandene (404). */
    private Project load(UUID id) {
        return Project.findByIdAndOwner(id, currentUser.subject()).orElseThrow(NotFoundException::new);
    }
}
