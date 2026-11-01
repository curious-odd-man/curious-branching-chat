package com.github.curiousoddman.curious_designer.test.utils;

import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AssignableTypeFilter;

import java.util.List;

public class TestUtilities {

    public static <T> List<T> instantiateImplementations(String packageName, Class<T> interfaceType) {
        var scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AssignableTypeFilter(interfaceType));

        return scanner.findCandidateComponents(packageName)
                      .stream()
                      .map(beanDefinition -> instantiate(
                              beanDefinition.getBeanClassName(),
                              interfaceType
                      ))
                      .toList();
    }

    private static <T> T instantiate(
            String className,
            Class<T> interfaceType
    ) {
        try {
            Class<?> clazz = Class.forName(className);

            return interfaceType.cast(
                    clazz.getDeclaredConstructor()
                         .newInstance()
            );
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(
                    "Could not instantiate " + className,
                    e
            );
        }
    }
}
