// Copyright (c) Facebook, Inc. and its affiliates.
const path = require('path');
const express = require('express');
const readLastLines = require('read-last-lines');
const compression = require('compression');
const tmp = require('tmp');
const config = require('./config');
const dfd = require("danfojs-node")
const { execSync } = require('child_process');

app = express();
app.use(compression({filter: () => true}));

/** Gets a list of available runs, with related information.
 * The files are searched in dataPath (possibily exploring
 * subfolders recursively).
 * readLast is the number of runs to be read starting from
 * the bottom of each stats.csv file. Note that this is not
 * equivalent to the number of runs that will be returned, since
 * lines can be filtered by the processLines function.
 * Returns a list of dicts (JSON).
 */
async function getRunsInfo(dataPath, readLast, recursively) {
  console.log(`Trying to read ${readLast} runs from folder: ${dataPath}.`);

  try {
      let df = await dfd.readCSV(dataPath); // Use await to wait for the promise to resolve

      df = df.rename(
        { 
          "death": "end_status",
          "max_hitpoints": "hp",
          "len": "steps",
          "experience_level": "xplvl",
          "sokobanfillpit_score": "sokoban",
        }
      );

      let valuesToRemove = ["end_status", "score", "steps", "turns", "hp", "dlvl", "sokoban", "role", "race", "gender", "ttyrecname"];
      let filteredArray = df.columns.filter(value => !valuesToRemove.includes(value));
      df = df.drop({ columns: filteredArray });
      df = df.addColumn("ttyrec", df["ttyrecname"].map(value => {
        const dirname = path.dirname(dataPath);
        const fullPath = path.join(dirname, "nle_data", value);
        return fullPath;
      }));
      console.log(`Found ${df.shape[0]} runs.`);

      return df;

  } catch (err) {
      console.log(err);
      return null;
  }
}

/** Creates meaningful error messages with a standard format.
 */
function createErrorMessage(code, request, params='', extraInfo='') {
  return `Call to ${request} returned code ${code}.\n` +
         `=> Parameters:\n${params}\n` +
         `=> Extra info:\n${extraInfo}`;
}

// Serve app.
app.use(express.static(path.join(__dirname + '/app')));
// Serve term.js.
app.use(
    '/third_party/term.js',
    express.static(path.join(__dirname + '/node_modules/term.js/src/term.js')),
);

// Requests.
app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});
app.get('/runs_info', (req, res) => {
  // Returns a json with the info about the runs.
  // If the path parameter is not set, search the data in
  // config.data.defaultPath.
  // Accepted parameters:
  // - path (string): path to the folder with the data.
  // - readLast (integer): number of lines to read at the bottom of the
  //   stats.csv file(s).
  // - recursively (boolean): if true, search for stats.csv files recursively.
  const dataPath =
    typeof req.query.path !== 'undefined' ? decodeURIComponent(req.query.path) :
                                          config.data.defaultPath;
  const readLast =
    typeof req.query.readLast !== 'undefined' ? parseInt(req.query.readLast) :
                                              config.data.defaultRunsToRead;
  const recursively = req.query.recursively === 'true';

  getRunsInfo(dataPath, readLast, recursively)
      .then((runsInfo) => {
        res.set('Content-Type', 'application/json');
        res.status(200).send(dfd.toJSON(runsInfo));
      })
      .catch((error) => {
        if (error.message == 'file does not exist') {
          // Stats file not existent in the specified folder.
          res.status(404).send(
              createErrorMessage(
                  404,
                  '/runs_info',
                  `path: ${req.query.path}`,
                  `No available stats file has been found.\n` +
                  `Path: ${dataPath}.\n` +
                  `Stats file (not found): ` +
                  `${path.join(dataPath, config.data.stats)}.`,
              ),
          );
        } else {
          // Other error.
          res.status(500).send(createErrorMessage(500, '/runs_info'));
          console.log(error);
        }
      });
});
app.get('/ttyrec_file', (req, res) => {
  // Returns the data for a particular ttyrec file, given its absolute
  // filepath.
  // Accepted parameters:
  // - ttyrec: name of the ttyrec file.
  // - datapath: path to the zip file.
  if (typeof req.query.datapath === 'undefined') {
    res.status(400).send(
        createErrorMessage(
            400,
            '/ttyrec_file',
            `ttyrec: ${req.query.ttyrec}`,
            `datapath: ${req.query.datapath}`,
            'No path has been passed to /ttyrec_file.',
        ),
    );
  } else {
    const ttyrecname = decodeURIComponent(req.query.ttyrec);
    let datapath = decodeURIComponent(req.query.datapath);

    // if (!path.isAbsolute(datapath)) {
    //   // Make filepath relative to this folder.
    //   console.log(`Received a relative datapath: ${datapath}. ` +
    //               `Adding this folder as prefix.`);
    //   datapath = path.join(__dirname, datapath);
    // }
    try {
      let lastDotIndex = ttyrecname.lastIndexOf('.');
      let filenameWithoutExtension = ttyrecname.substring(0, lastDotIndex);        
      const tempDir = tmp.dirSync();
      const temppath = path.join(tempDir.name, path.basename(filenameWithoutExtension));

      execSync(`bzip2 -d -c ${ttyrecname} > ${temppath}`);
      console.log('Decompression and write complete!');

      res.sendFile(temppath);
      console.log(`Serving ttyrec file: ${temppath}.`);
      // fs.unlinkSync(temppath);
    } catch (error) {
      if (error instanceof TypeError) {
        // File not found.
        res.status(404).send(
            createErrorMessage(
                404,
                '/ttyrec_file',
                `ttyrec: ${ttyrecname}`,
                `datapath: ${datapath}`,
                `File ${temppath} not found.`,
            ),
        );
      } else {
        // Other error.
        res.status(500).send(createErrorMessage(500, '/ttyrec_file'));
        console.log(error);
      }
    }
  }
});

app.listen(config.serverPort).on('error', () => {
  console.log(`ERROR: port ${config.serverPort} already in use.\n` +
              `You may have other servers already running. ` +
              `You can view them by running:\n` +
              `ps aux | grep "node server.js"\n` +
              `(and then you can kill the relevant processes).`);
});
