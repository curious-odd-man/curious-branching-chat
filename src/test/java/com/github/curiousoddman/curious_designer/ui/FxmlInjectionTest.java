package com.github.curiousoddman.curious_designer.ui;

import javafx.application.Platform;
import javafx.fxml.FXMLLoader;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.io.IOException;
import java.lang.reflect.Field;
import java.net.URL;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.stream.Stream;

import static com.sun.javafx.util.Utils.runOnFxThread;
import static org.junit.jupiter.api.Assertions.assertNotNull;

public class FxmlInjectionTest {
    private static final Path FXML_ROOT_PATH = Path.of("src/main/resources/fxml");


    @BeforeAll
    static void startJavaFx() throws InterruptedException {
        CountDownLatch latch = new CountDownLatch(1);

        try {
            Platform.startup(latch::countDown);
        } catch (IllegalStateException e) {
            // Toolkit was already started.
            latch.countDown();
        }

        latch.await();
    }


    public static Stream<Path> allFxmlFiles() throws IOException {
        List<Path> fxmlFiles = new ArrayList<>();
        Files.walkFileTree(FXML_ROOT_PATH, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                fxmlFiles.add(file);
                return FileVisitResult.CONTINUE;
            }
        });
        return fxmlFiles.stream();
    }

    @MethodSource("allFxmlFiles")
    @ParameterizedTest
    void fxmlFieldsAreInjected(Path fxmlFilePath) throws Exception {
        runOnFxThread(() -> {
            try {
                URL fxml = fxmlFilePath.toAbsolutePath()
                                       .toUri()
                                       .toURL();
                assertNotNull(fxml, "FXML file not found");

                FXMLLoader loader = new FXMLLoader(fxml);
                loader.setControllerFactory(new MockControllerFactory());
                loader.load();

                Object controller = loader.getController();

                assertNotNull(controller);

                assertAllFxmlFieldsInjected(controller);
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    private static void assertAllFxmlFieldsInjected(Object controller) throws IllegalAccessException {

        for (Field field : controller.getClass()
                                     .getDeclaredFields()) {
            if (!field.isAnnotationPresent(javafx.fxml.FXML.class)) {
                continue;
            }

            field.setAccessible(true);

            assertNotNull(
                    field.get(controller),
                    () -> "FXML field was not injected: "
                            + controller.getClass()
                                        .getSimpleName()
                            + "."
                            + field.getName()
            );
        }
    }
}
