"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
/*
 * IMPORTANT: Only modify action.ts. Any modifications to action.js will be lost.
 */
// Import NodeJS modules we will need
const os = require("os"), fs = require("fs"), path = require("path"), https = require("https"), spawn = require("child_process").spawn, 
// Import additional modules
validUrl = require('valid-url');
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 3] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 2] = "INFO";
    LogLevel[LogLevel["WARN"] = 1] = "WARN";
})(LogLevel || (LogLevel = {}));
class Log {
    static fail(message, ...optionalParameters) {
        console.error("FATAL ERROR: " + message, optionalParameters);
        if (!optionalParameters)
            message += os.EOL + JSON.stringify(optionalParameters);
        throw new Error(message);
    }
    static warning(message, ...optionalParameters) {
        if (this.LogLevel >= LogLevel.WARN)
            console.warn(message, optionalParameters);
    }
    static info(message, ...optionalParameters) {
        if (this.LogLevel >= LogLevel.INFO)
            console.log(message, optionalParameters);
    }
    static debug(message, ...optionalParameters) {
        if (this.LogLevel >= LogLevel.DEBUG)
            console.debug(message, optionalParameters);
    }
}
Log.LogLevel = LogLevel.DEBUG;
class Action {
    /* Main entry point */
    run() {
        return __awaiter(this, void 0, void 0, function* () {
            // Read input variables
            let config = this.readInputs();
            // Validate input variables and populate variables if necessary
            this.validateAndPopulateInputs(config);
            // Check if package exists on NuGet server.
            const nugetPackageExists = yield this.checkNuGetPackageExistsAsync(config.nugetSource, config.packageName, config.packageVersion);
            Log.info(`NuGet package "${config.packageName}" version "${config.packageVersion}" does${nugetPackageExists ? "" : " not"} exists on NuGet server "${config.nugetSource}".`);
            // If package does exist we will stop here.
            if (nugetPackageExists) {
                Log.info("Will not publish NuGet package because this version already exists on NuGet server.");
                return;
            }
            // Rebuild project if specified
            if (config.rebuildProject)
                yield this.rebuildProjectAsync(config.projectFilePath);
            // Package project
            yield this.packageProjectAsync(config.projectFilePath, config.nugetSearchPath, config.includeSymbols);
            // Publish package
            yield this.publishPackageAsync(config.nugetSource, config.nugetKey, config.nugetSearchPath, config.includeSymbols);
            // Commit a tag if publish was successful
            if (config.tagCommit) {
                const tag = config.tagFormat.replace("*", config.packageVersion);
                yield this.gitCommitTagAsync(tag);
            }
        });
    }
    /** Write OUTPUT variables */
    outputVariable(name, value) {
        Log.debug(`Setting output \"${name}\" to \"${value}\".`);
        process.stdout.write(`::set-output name=${name}::${value}${os.EOL}`);
    }
    /** Execute command and route stdout and stderr to apps respective channels */
    executeAsync(command, args = [], logSafeArgs = null, options = null) {
        return __awaiter(this, void 0, void 0, function* () {
            if (logSafeArgs === null)
                logSafeArgs = args;
            Log.info(`[executeAsync] Executing command: ${command} ${logSafeArgs.join(" ")}`);
            options = options || {};
            options.stdio = [process.stdin, process.stdout, process.stderr];
            return new Promise((resolve, reject) => {
                var cmd = spawn(command, args, options);
                cmd.on('close', (code) => {
                    if (code !== 0)
                        Log.fail(`Child process exited with code ${code}. Any code != 0 indicates an error.`);
                    else
                        Log.info(`[executeAsync] Done executing command: ${command} ${logSafeArgs.join(" ")}.`);
                    resolve(code);
                });
                cmd.on('error', (err) => {
                    Log.fail(err);
                    reject(err);
                });
            });
        });
    }
    /** Read INPUT environment variables */
    readInputs() {
        let config = {};
        config.projectFilePath = process.env.INPUT_PROJECT_FILE_PATH || process.env.PROJECT_FILE_PATH;
        config.nugetKey = process.env.INPUT_NUGET_KEY || process.env.NUGET_KEY;
        config.nugetSource = process.env.INPUT_NUGET_SOURCE || process.env.NUGET_SOURCE;
        config.tagFormat = process.env.INPUT_TAG_FORMAT || process.env.TAG_FORMAT;
        config.packageName = process.env.INPUT_PACKAGE_NAME || process.env.PACKAGE_NAME;
        config.packageVersion = process.env.INPUT_VERSION_STATIC || process.env.VERSION_STATIC;
        config.versionFilePath = process.env.INPUT_VERSION_FILE_PATH || process.env.VERSION_FILE_PATH;
        config.versionRegex = process.env.INPUT_VERSION_REGEX || process.env.VERSION_REGEX;
        let key;
        let value;
        try {
            key = "INCLUDE_SYMBOLS";
            value = process.env.INPUT_INCLUDE_SYMBOLS || process.env.INCLUDE_SYMBOLS || "false";
            config.includeSymbols = JSON.parse(value);
            key = "TAG_COMMIT";
            value = process.env.INPUT_TAG_COMMIT || process.env.TAG_COMMIT || "false";
            config.tagCommit = JSON.parse(value);
            key = "REBUILD_PROJECT";
            value = process.env.INPUT_REBUILD_PROJECT || process.env.REBUILD_PROJECT || "true";
            config.rebuildProject = JSON.parse(value);
            key = "LOG_LEVEL";
            value = process.env.INPUT_LOG_LEVEL || process.env.LOG_LEVEL || "DEBUG";
            config.logLevel = LogLevel[value] || LogLevel.DEBUG;
        }
        catch (error) {
            Log.fail(`Error parsing variable "${key}" value "${value}": ${error}`);
        }
        return config;
    }
    /** Validates the user inputs from GitHub Actions */
    validateAndPopulateInputs(config) {
        // Check that we have a valid project file path
        !fs.existsSync(config.projectFilePath) && Log.fail(`Project path "${config.projectFilePath}" does not exist.`);
        !fs.lstatSync(config.projectFilePath).isFile() && Log.fail(`Project path "${config.projectFilePath}" must be a directory.`);
        Log.debug(`Project path exists: ${config.projectFilePath}`);
        // Check that we have a valid nuget key
        !config.nugetKey && Log.fail(`NuGet key must be specified.`);
        // Check that we have a valid nuget source
        !validUrl.isUri(config.nugetSource) && Log.fail(`NuGet source "${config.nugetSource}" is not a valid URL.`);
        // If we don't have a static package version we'll need to look it up
        if (!config.packageVersion) {
            // Check that we have a valid version file path
            !fs.existsSync(config.versionFilePath) && Log.fail(`Version file path "${config.versionFilePath}" does not exist.`);
            !fs.lstatSync(config.versionFilePath).isFile() && Log.fail(`Version file path "${config.versionFilePath}" must be a directory.`);
            Log.debug(`Version file path exists: "${config.versionFilePath}"`);
            // Check that regex is correct
            let versionRegex;
            try {
                versionRegex = new RegExp(config.versionRegex, "m");
            }
            catch (e) {
                Log.fail(`Version regex "${config.versionRegex}" is not a valid regular expression: ${e.message}`);
            }
            // Read file content
            const versionFileContent = fs.readFileSync(config.versionFilePath);
            const version = versionRegex.exec(versionFileContent);
            if (!version)
                Log.fail(`Unable to find version using regex "${config.versionRegex}" in file "${config.versionFilePath}".`);
            // Successfully read version
            config.packageVersion = version[1];
        }
        // Check that we have a valid tag format
        if (config.tagCommit) {
            !config.tagFormat && Log.fail(`Tag format must be specified.`);
            !config.tagFormat.includes("*") && Log.fail(`Tag format "${config.tagFormat}" does not contain *.`);
            Log.debug("Valid tag format: %s", config.tagFormat);
        }
        if (!config.packageName) {
            const { groups: { name } } = config.projectFilePath.match(/(?<name>[^\/]+)\.[a-z]+$/i);
            config.packageName = name;
            Log.debug(`Package name not specified, extracted from PROJECT_FILE_PATH: "${config.packageName}"`);
        }
        !config.packageName && Log.fail(`Package name must be specified.`);
        // Where to search for NuGet packages
        config.nugetSearchPath = path.dirname(config.projectFilePath);
    }
    /** Check NuGet server if package exists and if specified version of that package exists. */
    checkNuGetPackageExistsAsync(nugetSource, packageName, version) {
        return __awaiter(this, void 0, void 0, function* () {
            const url = `${nugetSource}/v3-flatcontainer/${packageName}/index.json`;
            Log.info(`[checkNugetPackageExistsAsync] Checking if NuGet package exists on NuGet server: \"${url}\"`);
            return new Promise((packageVersionExists) => {
                https.get(url, (res) => {
                    let data = "";
                    if (res.statusCode == 404) {
                        Log.debug(`NuGet server returned HTTP status code ${res.statusCode}: Package "${packageName}" does not exist.`);
                        packageVersionExists(false);
                        return;
                    }
                    if (res.statusCode != 200) {
                        throw new Error(`NuGet server returned unexpected HTTP status code ${res.statusCode}: ${res.statusMessage} Assuming failure.`);
                        packageVersionExists(false);
                        return;
                    }
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        // We should now have something like: { "versions": [ "1.0.0", "1.0.1" ] }
                        // Parse JSON and check if the version exists
                        const packages = JSON.parse(data);
                        const exists = packages.versions.includes(version);
                        Log.debug(`NuGet server returned: ${packages.versions.length} package versions. Package version "${version}" is${exists ? "" : " not"} in list.`);
                        packageVersionExists(exists);
                        return;
                    });
                    res.on("error", e => {
                        Log.fail(e);
                        packageVersionExists(false);
                        return;
                    });
                });
            });
        });
    }
    /** Rebuild the project using dotnet build */
    rebuildProjectAsync(projectFilePath) {
        return __awaiter(this, void 0, void 0, function* () {
            Log.info(`[rebuildProjectAsync] Rebuilding project: \"${projectFilePath}\"`);
            yield this.executeAsync("dotnet", ["build", "-c", "Release", projectFilePath]);
        });
    }
    /** Package the project using dotnet pack */
    packageProjectAsync(projectFilePath, nugetSearchPath, includeSymbols) {
        return __awaiter(this, void 0, void 0, function* () {
            Log.info(`[packageProjectAsync] Packaging project: \"${projectFilePath}\" to "${nugetSearchPath}"`);
            // Remove existing packages
            fs.readdirSync(nugetSearchPath).filter((fn) => /\.s?nupkg$/.test(fn)).forEach((fn) => fs.unlinkSync(`${nugetSearchPath}/${fn}`));
            // Package new
            let params = ["pack", "-c", "Release"];
            if (includeSymbols) {
                params.push("--include-symbols");
                params.push("-p:SymbolPackageFormat=snupkg");
            }
            params.push(projectFilePath);
            params.push("-o");
            params.push(nugetSearchPath);
            yield this.executeAsync("dotnet", params);
        });
    }
    /** Publish package to NuGet server using dotnet nuget push */
    publishPackageAsync(nuGetSource, nugetKey, nugetSearchPath, includeSymbols) {
        return __awaiter(this, void 0, void 0, function* () {
            // Find files
            const packages = fs.readdirSync(nugetSearchPath).filter((fn) => fn.endsWith("nupkg"));
            const packageFilename = packages.filter((fn) => fn.endsWith(".nupkg"))[0];
            Log.info(`[publishPackageAsync] Publishing package "${nugetSearchPath}/${packageFilename}"`);
            let params = ["dotnet", "nuget", "push", `${nugetSearchPath}/${packageFilename}`, "-s", `${nuGetSource}/v3/index.json`, "--skip-duplicate", "--force-english-output"];
            if (!includeSymbols)
                params.push("--no-symbols");
            // Separate param array that is safe to log (no nuget key)
            let paramsLogSafe = params.concat(["-k", "NUGET_KEY_HIDDEN"]);
            params = params.concat(["-k", nugetKey]);
            yield this.executeAsync("dotnet", params, paramsLogSafe);
            // We set some output variables that following steps may use
            this.outputVariable("PACKAGE_NAME", packageFilename);
            this.outputVariable("PACKAGE_PATH", path.resolve(packageFilename));
            if (includeSymbols) {
                const symbolsFilename = packages.filter((fn) => fn.endsWith(".snupkg"))[0];
                this.outputVariable("SYMBOLS_PACKAGE_NAME", symbolsFilename);
                this.outputVariable("SYMBOLS_PACKAGE_PATH", path.resolve(symbolsFilename));
            }
        });
    }
    /** Push a tag on current commit using git tag and git push */
    gitCommitTagAsync(tag) {
        return __awaiter(this, void 0, void 0, function* () {
            Log.info(`[gitCommitTagAsync] Creating tag: ${tag}`);
            yield this.executeAsync("git", ["tag", tag]);
            yield this.executeAsync("git", ["push", "origin", tag]);
            this.outputVariable("VERSION", tag);
        });
    }
}
// Run the action
(new Action()).run();
//# sourceMappingURL=action.js.map