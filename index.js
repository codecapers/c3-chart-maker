'use strict';

//
// This is a function to generate a chart using Nightmare, Data-Forge and C3.
// Please see README.md for examples.
//
// Parameters:
//
//      inputFilePath -     The input CSV file to load.
//      chartTemplateFile - Path to a C3 spec file (either json or js).
//      outputFilePath -    Path that specifies where to save the chart's output image.
//      options -           Options to control rendering.
//          show            Set to true to show the browser window that renderers the chart.
//

const Nightmare = require('nightmare');
const dataForge = require('data-forge');
const path = require('path');
const assert = require('chai').assert;
const fs = require('fs');
const argv = require('yargs').argv;

module.exports = function (inputFilePathOrDataFrame, chartTemplateFilePathOrChartDefinition, outputFilePath, options, nightmare) {
    var isChartDefFilePath = typeof(chartTemplateFilePathOrChartDefinition) === "string";
    if (!isChartDefFilePath) {
        assert.isObject(chartTemplateFilePathOrChartDefinition, "c3-chart-maker: Expected parameter chartTemplateFilePathOrChartDefinition to be a string (a path to the chart definition JSON file) or an object (the chart definition itself).");
    }
    assert.isString(outputFilePath, "c3-chart-maker: Expected parameter outputFilePath to be a string.");

    options = options || {};

    if (options.cssFilePath) {
        assert.isString(options.cssFilePath, "c3-chart-maker: Expected options.cssFilePath (if specified) to be a string.")
    }

    var dataFrame;
    var isInputFilePath = typeof(inputFilePathOrDataFrame) === "string";
    if (isInputFilePath) {
        dataFrame = dataForge.readFileSync(inputFilePathOrDataFrame)
            .parseCSV();
    }
    else {
        dataFrame = inputFilePathOrDataFrame;        
    }

    var ownNightmare = false;

    if (!nightmare) {
        ownNightmare = true;
        nightmare = new Nightmare({
            frame: false,
            show: options.show,
        });
    }

    nightmare.on('console', function (type, message) {

        if (type === 'log') {
            console.log('LOG: ' + message);
            return; // Don't bother with logs.
        }

        if (type === 'warn') {
            console.warn('LOG: ' + message);
            return;
        }

        if (type === 'error') {
            throw new Error("Browser JavaScript error: " + message);
        }
    });

    var filePath = path.join(__dirname, 'template.html');
    var url = 'file://' + filePath;
    var selector = '#view svg';

    var chart = null;

    if (isChartDefFilePath) {
        var chartTemplateFilePath = chartTemplateFilePathOrChartDefinition;
        if (chartTemplateFilePath.endsWith(".json")) {
            // Load json file.
            chart = JSON.parse(fs.readFileSync(chartTemplateFilePath, 'utf-8'));
        }
        else if (chartTemplateFilePath.endsWith(".js")) {
            // Load Node.js module.
            var fullPath = path.resolve(chartTemplateFilePath);
            chart = require(fullPath)(dataFrame, argv);
        }
        else {
            throw new Error("Unable to determine type of input file " + chartTemplateFilePath + ", expected a .json or .js file." );
        }
    }
    else {
        chart = chartTemplateFilePathOrChartDefinition;
    }

    if (!chart.data) {
        chart.data = {};
    }

    chart.bindto = "#view";

    if (chart.series) {
        if (!chart.data.columns) {
            chart.data.columns = [];
        }

        var series = Object.keys(chart.series);
        series.forEach(seriesName => {
            var dataSeries = chart.series[seriesName];
            if (isInputFilePath && seriesName !== "x") {
                dataFrame = dataFrame.parseFloats(dataSeries).bake();
            }

            chart.data.columns.push(
                [seriesName].concat(
                    dataFrame.getSeries(dataSeries)
                        .select(v => v === undefined ? null : v)
                        .toArray()
                )
            )
        });
    }
    else {
        chart.data.json = dataFrame.toArray();
    }

    if (argv.dumpChart) { //TODO: This should be an API option.
        console.log(JSON.stringify(chart, null, 4));
    }

    nightmare.goto(url);

    if (options.cssFilePath) {
        nightmare.inject('css', options.cssFilePath);
    }

    nightmare.evaluate(chart => {
        // Add chart data.
        c3.generate(chart);
    }, chart);
        
    return nightmare.wait(selector)
        .evaluate(selector => {
            const body = document.querySelector('body');
            const element = document.querySelector(selector);
            const rect = element.getBoundingClientRect();
            return {
                bodyWidth: body.scrollWidth,
                bodyHeight: body.scrollHeight,
                x: rect.left,
                y: rect.top,
                height: rect.bottom - rect.top,
                width: rect.right - rect.left,
            };
        }, selector)
        .then(rect => {
            return nightmare.viewport(rect.bodyWidth, rect.bodyHeight)
                .screenshot(outputFilePath, rect);
        })
        //.then(() => nightmare.screenshot("whole-page.png"))
        .then(() => {
            if (ownNightmare) {
                return nightmare.end();
            }
        })
        .catch(err => {
            if (ownNightmare) {
                return nightmare.end()
                    .then(() => {
                        throw err
                    });
            }
            else {
                throw err
            }
        });
};
