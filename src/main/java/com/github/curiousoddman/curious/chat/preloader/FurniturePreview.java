package com.github.curiousoddman.curious.chat.preloader;

import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.paint.Color;

public class FurniturePreview extends Canvas {

    private double buildProgress = 0;

    public FurniturePreview(double width, double height) {
        super(width, height);

        draw();
    }

    public void setBuildProgress(double progress) {
        this.buildProgress = Math.clamp(progress, 0, 1);
        draw();
    }

    private void draw() {

        GraphicsContext gc = getGraphicsContext2D();

        double w = getWidth();
        double h = getHeight();

        gc.clearRect(0, 0, w, h);

        gc.setLineWidth(1.2);
        gc.setStroke(Color.rgb(88, 166, 255, 0.75));

        double x = w / 2 - 120;
        double y = h / 2 - 70;

        double width  = 240;
        double height = 140;

        // Back cabinet
        if (buildProgress > 0.15) {
            drawRectangle(gc, x, y, width, height);
        }

        // Shelf
        if (buildProgress > 0.35) {
            double shelfProgress =
                    Math.min(1, (buildProgress - 0.35) / 0.2);

            double shelfY = y + height * shelfProgress * 0.5;

            gc.strokeLine(
                    x + 5,
                    shelfY,
                    x + width - 5,
                    shelfY
            );
        }

        // Door
        if (buildProgress > 0.55) {

            double doorProgress =
                    Math.min(1, (buildProgress - 0.55) / 0.2);

            double doorWidth = 100 * doorProgress;

            gc.strokeRect(
                    x + width - doorWidth - 10,
                    y + 10,
                    doorWidth,
                    height - 20
            );
        }

        // Legs
        if (buildProgress > 0.75) {

            double legProgress =
                    Math.min(1, (buildProgress - 0.75) / 0.25);

            double legHeight = 35 * legProgress;

            gc.strokeLine(
                    x + 20,
                    y + height,
                    x + 20,
                    y + height + legHeight
            );

            gc.strokeLine(
                    x + width - 20,
                    y + height,
                    x + width - 20,
                    y + height + legHeight
            );
        }

        drawDimensions(gc, x, y, width, height);
        drawOrigin(gc, x, y, width, height);
    }

    private void drawRectangle(
            GraphicsContext gc,
            double x,
            double y,
            double width,
            double height) {

        gc.strokeRect(x, y, width, height);
    }

    private void drawDimensions(
            GraphicsContext gc,
            double x,
            double y,
            double width,
            double height) {

        gc.setStroke(Color.rgb(120, 130, 140, 0.35));
        gc.setLineWidth(0.7);

        // Width dimension
        double dimensionY = y + height + 65;

        gc.strokeLine(
                x,
                dimensionY,
                x + width,
                dimensionY
        );

        gc.strokeLine(
                x,
                dimensionY - 5,
                x,
                dimensionY + 5
        );

        gc.strokeLine(
                x + width,
                dimensionY - 5,
                x + width,
                dimensionY + 5
        );

        // Height dimension
        double dimensionX = x - 55;

        gc.strokeLine(
                dimensionX,
                y,
                dimensionX,
                y + height
        );

        gc.strokeLine(
                dimensionX - 5,
                y,
                dimensionX + 5,
                y
        );

        gc.strokeLine(
                dimensionX - 5,
                y + height,
                dimensionX + 5,
                y + height
        );
    }

    private void drawOrigin(
            GraphicsContext gc,
            double x,
            double y,
            double width,
            double height) {

        double ox = x + width + 40;
        double oy = y + height;

        gc.setStroke(Color.rgb(120, 130, 140, 0.5));

        gc.strokeLine(ox, oy, ox + 30, oy);
        gc.strokeLine(ox, oy, ox, oy - 30);
    }
}