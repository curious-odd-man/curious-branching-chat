package com.github.curiousoddman.curious_designer.ui;


import javafx.util.Callback;
import org.mockito.Mockito;

import java.lang.reflect.Constructor;
import java.util.Arrays;
import java.util.Comparator;

public final class MockControllerFactory implements Callback<Class<?>, Object> {

    @Override
    public Object call(Class<?> controllerClass) {
        try {
            Constructor<?> constructor = Arrays.stream(controllerClass.getDeclaredConstructors())
                                               .max(Comparator.comparingInt(Constructor::getParameterCount)
                                               )
                                               .orElseThrow();

            constructor.setAccessible(true);

            Object[] arguments = Arrays.stream(constructor.getParameterTypes())
                                       .map(Mockito::mock)
                                       .toArray();

            return constructor.newInstance(arguments);

        } catch (Exception e) {
            throw new RuntimeException("Cannot instantiate controller: " + controllerClass.getName(), e);
        }
    }
}