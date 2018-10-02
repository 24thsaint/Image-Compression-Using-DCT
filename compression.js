var img = new Image();
img.crossOrigin = "Anonymous";
img.src = 'sample.jpg';

var canvas = document.getElementById('canvas');
var ctx = canvas.getContext('2d');

var progress = document.getElementById('progress');
var debug = false;
var quality = 1;

window.onload = function () {
  progress.innerHTML = "Ready.";
}

/**
 * Recommended quantization table for JPEG:
 * https://web.stanford.edu/class/ee398a/handouts/lectures/08-JPEG.pdf
 */
const standardQuantization = [
  [16, 11, 10, 16, 24, 40, 51, 61],
  [12, 12, 14, 19, 26, 58, 60, 55],
  [14, 13, 16, 24, 40, 57, 69, 56],
  [14, 17, 22, 29, 51, 87, 80, 62],
  [18, 22, 37, 56, 68, 109, 103, 77],
  [24, 35, 55, 64, 81, 104, 113, 92],
  [49, 64, 78, 87, 103, 121, 120, 101],
  [72, 92, 95, 98, 112, 100, 103, 99]
];

var adjustedQuantizationTable = initializeEmptyMatrix();

function render() {
  progress.innerHTML = "Original Image Loaded!";
  ctx.drawImage(img, 0, 0);
}

/**
 * Extracts an 8x8 rgb pixel from the canvas and
 * performs dct on that pixel section.
 */
function compress() {
  progress.innerHTML = "Compressing...";
  var section = [];
  var width = debug ? 8 : canvas.width;
  var height = debug ? 8 : canvas.height;
  quality = document.getElementById('quality').value;

  for (let xOut = 0; xOut < width; xOut += 8) {
    for (let yOut = 0; yOut < height; yOut += 8) {
      setTimeout(function () {
        for (let x = 0; x < 8; x++) {
          var subSection = [];
          for (let y = 0; y < 8; y++) {
            var pixel = ctx.getImageData(x + xOut, y + yOut, 1, 1);
            subSection.push(Array.from(pixel.data));
          }
          section.push(subSection);
        }

        operate(section);
        if (debug) {
          console.log(section);
        }

        for (let x = 0; x < 8; x++) {
          for (let y = 0; y < 8; y++) {
            var imageData = new ImageData(1, 1);
            const data = imageData.data;

            for (let i = 0; i < 4; i++) {
              data[i] = Math.round(section[x][y][i]);
            }
            ctx.putImageData(imageData, x + xOut, y + yOut);
          }
        }

        section = [];

        let progressCount = xOut + 8;
        let percentage = (progressCount / width) * 100;
        progress.innerHTML = `Compressing... ${percentage.toFixed(2)}% complete.`;
      }, 1)
    }
  }
}

function operate(section) {
  // --- Encoding start
  calculateQuantizationTable(quality);
  normalize(section, -1);
  dct(section);
  quantize(section);
  // --- Encoding end

  // --- Decoding start
  dequantize(section);
  inversedct(section);
  normalize(section, 1); // Denormalize
  // -- Decoding end
}

/**
 * The elements in the quantization matrix control the compression 
 * ratio, with larger values producing greater compression.
 * 
 * This function calculates an adjusted quantization table 
 * depending on target image quality.
 * 
 * The equation used to calculate the table is taken from:
 * https://dfrws.org/sites/default/files/session-files/pres-using_jpeg_quantization_tables_to_identify_imagery_processed_by_software.pdf
 * 
 * @param {string} quality - The target quality of image
 */
function calculateQuantizationTable(quality) {
  const S = (quality < 50) ? (5000 / quality) : ((200) - (2 * quality));

  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      var quantizationValue = Math.floor(((S * standardQuantization[x][y]) + 50) / 100);
      if (quantizationValue == 0) {
        quantizationValue = 1;
      }
      adjustedQuantizationTable[x][y] = quantizationValue;
    }
  }
}

/**
 * Before computing the DCT of the 8×8 block, 
 * its values are shifted from a positive range to one centered on zero. 
 * For an 8-bit image, each entry in the original block falls in the range 
 * [0,255]. The midpoint of the range (in this case, the value 128) 
 * is subtracted from each entry to produce a data range that is centered 
 * on zero, so that the modified range is [-128,127]. 
 * 
 * This step reduces the dynamic range requirements in the DCT processing 
 * stage that follows.
 * 
 * @param {8x8 integer array} section of 8x8 rgb pixel
 * @param {1|-1} factor that determines if the action is normalization (-1) or denormalization (1)
 */
function normalize(section, factor) {
  for (let channel = 0; channel < 3; channel++) {
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        section[x][y][channel] += (128 * factor);

        /**
         * Clip the output values so as to keep them within 
         * the [0-255] range to prevent overflow when storing the 
         * decompressed image with the original bit depth.
         */
        if (section[x][y][channel] > 255) {
          section[x][y][channel] = 255;
        }
      }
    }
  }
}

/**
 * Executes Discrete Cosine Transform on an 8x8 rgb pixel.
 * 
 * @param {8x8 integer array} section of 8x8 rgb pixel
 */
function dct(section) {
  let matrix = initializeEmptyMatrix();
  const fastFactorAu = (1 / Math.sqrt(2));

  for (let channel = 0; channel < 3; channel++) {
    for (let u = 0; u < 8; u++) {
      for (let v = 0; v < 8; v++) {
        var finalAnswer = 0;

        for (let x = 0; x < 8; x++) {
          var outerPartial = 0;
          for (let y = 0; y < 8; y++) {
            outerPartial += section[x][y][channel] * Math.cos((((2 * x) + 1) * u * Math.PI) / 16) * Math.cos((((2 * y) + 1) * v * Math.PI) / 16);
          }
          finalAnswer += outerPartial;
        }

        if (u == 0 && v !== 0) {
          finalAnswer *= (1 / Math.sqrt(2));
        }
        if (u != 0 && v == 0) {
          finalAnswer *= (1 / Math.sqrt(2));
        }
        if (u == 0 && v == 0) {
          finalAnswer *= 0.5;
        }

        finalAnswer *= 0.25;
        matrix[u][v] = finalAnswer;
      }
    }

    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        section[x][y][channel] = matrix[x][y];
      }
    }
  }
}

/**
 * The elements in the quantization matrix control the compression ratio, 
 * with larger values producing greater compression.
 * 
 * This function applies quantization to the 8x8 section with the adjusted 
 * quantization matrix taken from the from the calculateQuantizationTable() function.
 * 
 * @param {8x8 integer array} section of 8x8 rgb pixel
 */
function quantize(section) {
  for (let channel = 0; channel < 3; channel++) {
    for (let x = 0; x < section.length; x++) {
      for (let y = 0; y < section[x].length; y++) {
        section[x][y][channel] = Math.round(section[x][y][channel] / adjustedQuantizationTable[x][y]);
      }
    }
  }
}

/**
 * Reverses the quantization operation done on a section.
 * 
 * @param {8x8 integer array} section of 8x8 rgb pixel
 */
function dequantize(section) {
  for (let channel = 0; channel < 3; channel++) {
    for (let x = 0; x < section.length; x++) {
      for (let y = 0; y < section[x].length; y++) {
        section[x][y][channel] = section[x][y][channel] * adjustedQuantizationTable[x][y];
      }
    }
  }
}

/**
 * Reverses the DCT executed on a section.
 * The output is a decompressed subimage.
 * 
 * @param {8x8 integer array} section of 8x8 rgb pixel
 */
function inversedct(section) {
  var matrix = initializeEmptyMatrix();
  const fastFactorAu = (1 / Math.sqrt(2));

  for (let channel = 0; channel < 3; channel++) {
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        var finalAnswer = 0;

        for (let u = 0; u < 8; u++) {
          var outerPartial = 0;

          for (let v = 0; v < 8; v++) {
            var innerPartial = section[u][v][channel] * Math.cos((((2 * x) + 1) * u * Math.PI) / 16) * Math.cos((((2 * y) + 1) * v * Math.PI) / 16);

            if (u == 0 && v !== 0) {
              innerPartial *= (1 / Math.sqrt(2));
            }
            if (u != 0 && v == 0) {
              innerPartial *= (1 / Math.sqrt(2));
            }
            if (u == 0 && v == 0) {
              innerPartial *= 0.5;
            }

            outerPartial += innerPartial;
          }
          finalAnswer += outerPartial;
        }
        matrix[x][y] = Math.round(0.25 * finalAnswer);
      }
    }

    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        section[x][y][channel] = matrix[x][y];
      }
    }
  }
}

function initializeEmptyMatrix() {
  var matrix = [];
  for (var x = 0; x < 8; x++) {
    var xMatrix = [];
    for (var y = 0; y < 8; y++) {
      xMatrix.push(0);
    }
    matrix.push(xMatrix);
  }
  return matrix;
}

img.onload = function () {
  ctx.drawImage(img, 0, 0);
  img.style.display = 'none';
  render();
};

document.getElementById('original').onclick = render;
document.getElementById('compress').onclick = compress;