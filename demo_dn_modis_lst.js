/**
 * Download modis land surface temperature (LST) data
 * 
 * Steps
 * 1. get collection
 * 2. scale and mask
 * 3. add/update variables to plot/export
 * 4. export
 * 
 */

// choose dataset
var modisLST = ee.ImageCollection('MODIS/061/MOD11A2'); // 8-day, 1-km

// set roi (region of interest) and time period
var roi = ee.FeatureCollection("users/QiuYuean/City_of_Detroit_Boundary")

var start_date = '2018-04-01'
var end_date = '2021-09-30'

// zoom to region
Map.addLayer(roi, {}, "ROI")
Map.centerObject(roi)

// Helper function to extract the values from specific bits
// The input parameter can be a ee.Number() or ee.Image()
// Code adapted from https://gis.stackexchange.com/a/349401/5160
var bitwiseExtract = function (input, fromBit, toBit) {
    var maskSize = ee.Number(1).add(toBit).subtract(fromBit)
    var mask = ee.Number(1).leftShift(maskSize).subtract(1)
    return input.rightShift(fromBit).bitwiseAnd(mask)
}

var scaleModisLst = function (image) {
    /** Scale MODIS LST to celsius */
    // Apply the scaling factors to the appropriate bands.
    var thermalBands = image.select('LST_Day_1km').multiply(0.02).add(-273.15);
    // Replace the original bands with the scaled ones.
    return image.addBands(thermalBands, null, true)
}

// Function to cloud mask from the pixel_qa band of Landsat 8 SR data.
var maskModisLst = function (image) {
    // Bit 0-1 - Mandatory QA flags
    // Bit 2-3 - Data quality flag
    // Bit 4-5 - Emissivity error flag
    // Bit 6-7 - LST error flag
    var qcDay = image.select('QC_Day')
    var qaMask = bitwiseExtract(qcDay, 0, 1).lte(1);
    var dataQualityMask = bitwiseExtract(qcDay, 2, 3).eq(0)
    var lstErrorMask = bitwiseExtract(qcDay, 6, 7).lte(1)
    qaMask = qaMask.and(dataQualityMask).and(lstErrorMask).rename('qaMask')

    return image.addBands(qaMask).updateMask(qaMask);
};

// This function adds time.
var addVariablesTime = function (image) {
    // Image timestamp as milliseconds since Unix epoch.
    var millis = ee.Image(image.getNumber('system:time_start'))
        .rename('millis').toFloat();
    return image.addBands(millis);
};

// get image collection and add masks
var modisLST = modisLST.filterBounds(roi)
    .filter(ee.Filter.date(start_date, end_date))
    .map(scaleModisLst)
    .map(maskModisLst)
    .map(addVariablesTime)

//// plot a composite image
var visParams = { bands: 'LST_Day_1km', min: 0, max: 40, palette: ['white', 'yellow', 'red'] }

// un-comment to explore
// var lstMedian = modisLST.median()
// Map.addLayer(lstMedian, visParams, 'lstMedian');

// Create a cloud-free, most recent value composite.
var recentValueComposite = modisLST.qualityMosaic('millis');
Map.addLayer(recentValueComposite, visParams, 'recentValueComposite');

/** ------------------------------------------------------------------------- */
/** Plot time series -------------------------------------------------------- */
// Function to add NDVI, time, and constant variables
var addVariables = function (image) {
    // Compute time in fractional years since the epoch.
    var date = image.date();
    var years = date.difference(ee.Date('1970-01-01'), 'year');
    // Return the image with the added bands.
    return image
        // Add a time band.
        .addBands(ee.Image(years).rename('t')).float()
        // Add a constant band.
        .addBands(ee.Image.constant(1));
};

// Remove clouds, add variables and filter to the area of interest.
var modisLST = modisLST.map(addVariables);

var chart = ui.Chart.image.series(modisLST.select('LST_Day_1km'), roi, ee.Reducer.median())
    .setChartType('ScatterChart')
    .setOptions({
        title: 'MOD11A2 LST Time Series (median over the ROI)',
        trendlines: {
            0: { color: 'CC0000' }
        },
        lineWidth: 1,
        pointSize: 3,
    });
print(chart);

/** Plot for NDVI (optional) -------------------------------------------------------- */
var addVariablesMcd43a4 = function (image) {
    // Compute time in fractional years since the epoch.
    var date = image.date();
    var years = date.difference(ee.Date('1970-01-01'), 'year');
    // Return the image with the added bands.
    return image
        // Add an NDVI band.
        .addBands(image.normalizedDifference(['Nadir_Reflectance_Band2', 'Nadir_Reflectance_Band1']).rename('NDVI'))
        // Add a time band.
        .addBands(ee.Image(years).rename('t')).float()
        // Add a constant band.
        .addBands(ee.Image.constant(1));
};

var mcd43a4 = ee.ImageCollection('MODIS/061/MCD43A4')
    .filter(ee.Filter.date(start_date, end_date))
    .map(addVariablesMcd43a4);

// un-comment to explore
// Map.addLayer(mcd43a4.median(),
//     { bands: 'NDVI', min: 0.1, max: 0.9, palette: ['white', 'green'] },
//     'NDVI MCD43A4 median over the period');

var chart = ui.Chart.image.series(mcd43a4.select('NDVI'), roi, ee.Reducer.median())
    .setChartType('ScatterChart')
    .setOptions({
        title: 'MCD43A4 NDVI Time Series (median over the ROI)',
        trendlines: {
            0: { color: 'CC0000' }
        },
        lineWidth: 1,
        pointSize: 3,
    });
print(chart);

// overlap roi on image
Map.addLayer(roi, {}, "ROI")

/** Export -------------------------------------------------------- */
var folder = 'GEO874_2023FA'
var modisToBands = modisLST.select('LST_Day_1km').toBands()
print(modisToBands) // make sure only output LST_Day_1km

// set a larger region to export
var roi_detroit = ee.Feature(roi.first())
var roi_buffer = roi_detroit.buffer(10000).bounds()
Map.addLayer(roi_buffer, {}, "roi_buffer")

// set projection
var crs = 'EPSG:4326'

/*
Export.image.toDrive({
    image: modisToBands,
    folder: folder,
    description: 'MOD11A2_detroit_2018_2021',
    fileNamePrefix: 'mod11a2_detroit_2018_2021',
    fileFormat: 'GeoTIFF',
    region: roi_buffer,
    scale: 1000,
    crs: crs,
});
*/


/**Version 2 month composite*/
// month composite
var year = 2018
var n_year = 4

var modisLST = ee.ImageCollection('MODIS/061/MOD11A2').filterBounds(roi)
    .filterDate(ee.Date.fromYMD(year, 1, 1), ee.Date.fromYMD(year + n_year, 1, 1))
    .map(scaleModisLst)
    .map(maskModisLst)
    .select(['LST_Day_1km'])

var modisLST_month = ee.List.sequence(0, n_year * 12 - 1, 1).map(function (n) {
    var start = ee.Date.fromYMD(year, 1, 1).advance(n, 'month');
    var end = start.advance(1, 'month');
    var tmpMedian = modisLST.filterDate(start, end).median().set("system:time_start", start.millis());
    return tmpMedian;
}).flatten();
var modisLST_month = ee.ImageCollection.fromImages(modisLST_month);
print("modisLST_month", modisLST_month);

var monthlyLST_month_bands = modisLST_month.toBands()
print(monthlyLST_month_bands)

Export.image.toDrive({
    image: monthlyLST_month_bands,
    folder: folder,
    description: 'MOD11A2_detroit_monthly_median',
    fileNamePrefix: 'mod11a2_detroit_monthly_median',
    fileFormat: 'GeoTIFF',
    region: roi_buffer,
    scale: 1000,
    crs: crs,
});
