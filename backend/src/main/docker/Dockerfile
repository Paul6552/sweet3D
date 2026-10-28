# Baut Frontend und Backend und liefert beides aus einem Quarkus-Container aus.
# Aufruf aus dem Projektwurzelverzeichnis: docker compose --profile prod up -d --build

FROM node:24-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM maven:3.9-eclipse-temurin-21 AS backend
WORKDIR /build
COPY backend/pom.xml ./
COPY backend/libs ./libs
RUN mvn -B -q dependency:go-offline
COPY backend/src ./src
COPY --from=frontend /build/dist ./src/main/resources/META-INF/resources
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=backend /build/target/quarkus-app/ ./
RUN mkdir -p /data/assets && chown -R 1001 /data
USER 1001
EXPOSE 8180
ENV JAVA_OPTS="-Djava.awt.headless=true"
CMD ["sh", "-c", "exec java $JAVA_OPTS -jar quarkus-run.jar"]
