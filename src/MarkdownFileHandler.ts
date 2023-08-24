import * as fs from "fs";
import * as path from "path";
import { MarkdownFile, MarkdownSourceFile } from "./MarkdownFile";
import { CONFIG } from "../main";

interface MdConversionEntry {
	sourcePath: string;
	targetPath: string;
}

/***************************************************************************************************************
 * Class MarkdownConverter responsible for converting Markdown files from a source directory to a target directory
 * Includes methods for parsing directories, handling conversion and managing metadata of conversions
 ***************************************************************************************************************/
class MarkdownFileHandler {
	sourceFolder: string;
	targetFolder: string;
	dataFile: string;

	constructor(
		sourceFolderPath: string,
		targetFolderPath: string,
		dataFilePath: string
	) {
		this.sourceFolder = sourceFolderPath;
		this.targetFolder = targetFolderPath;
		// JSON file that stores data around currently converted files
		this.dataFile = dataFilePath;
	}

	/**
	 * startConversion handles the conversion of source markdown files to target directory
	 * Checks for file state and decides whether to convert, delete or leave the file
	 */
	startConversion(): void {
		console.time("Conversion Time");
		const sourceFiles = this.parseMdFiles(this.sourceFolder);
		// Type Guard to ensure "sourceFiles" is of the correct type
		if (!isMarkdownSourceFileArray(sourceFiles)) {
			throw new Error(
				"Expected sourceFiles to be of type MarkdownSourceFile[]"
			);
		}
		const targetFiles = this.parseMdFiles(this.targetFolder);
		const mdConversionEntries = this.loadMdFilesFromJson();

		this.checkTargetFiles(targetFiles, sourceFiles, mdConversionEntries);
		this.checkSourceFiles(sourceFiles, targetFiles, mdConversionEntries);

		this.saveMdFilesToJson(mdConversionEntries);

		this.removeEmptyDirectories(this.targetFolder);

		this.resetDatabase();
		console.timeEnd("Conversion Time");
	}

	parseMdFiles(
		baseFolderPath: string
	): MarkdownFile[] | MarkdownSourceFile[] {
		const FIRST_LEVEL_SUBDIRS = ["docs", "blog", "i18n"];
		const MULTI_BLOG_ENDING = "__blog";
		let markdownFiles: MarkdownFile[] = [];
		let directories = [baseFolderPath];

		while (directories.length) {
			const currentFolderPath = directories.pop();

			// TS: Skip iteration if currentFolderPath is undefined
			if (typeof currentFolderPath === "undefined") {
				continue;
			}

			let entities = fs.readdirSync(currentFolderPath, {
				withFileTypes: true,
			});

			entities.forEach((entity) => {
				let fullEntityPath = path.join(currentFolderPath, entity.name);

				if (entity.isDirectory()) {
					if (currentFolderPath === baseFolderPath) {
						// If we are at the base folder level, only continue search in specified subfolders
						if (
							FIRST_LEVEL_SUBDIRS.includes(entity.name) ||
							entity.name.endsWith(MULTI_BLOG_ENDING)
						) {
							directories.push(fullEntityPath);
						}
					} else {
						// If we are already in a subfolder, continue search in all subfolders
						directories.push(fullEntityPath);
					}
				} else if (
					path.extname(entity.name) === ".md" ||
					path.extname(entity.name) === ".yml"
				) {
					if (baseFolderPath === CONFIG.obsidianVaultDirectory) {
						markdownFiles.push(
							new MarkdownSourceFile(
								baseFolderPath,
								fullEntityPath,
								entity.name
							)
						);
					} else {
						//console.log(fullEntityPath);
						markdownFiles.push(
							new MarkdownFile(baseFolderPath, fullEntityPath)
						);
					}
				}
			});
		}
		return markdownFiles;
	}

	/**
	 * saveMdFilesToJson saves metadata of Markdown files to a JSON file
	 *
	 * @param {MdConversionEntry[]} data array of conversion metadata
	 */
	saveMdFilesToJson(data: MdConversionEntry[]): void {
		try {
			fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2)); // Pretty print JSON
			console.log(`Data saved to ${this.dataFile}`);
		} catch (error) {
			console.error(`Error saving data to ${this.dataFile}: ${error}`);
		}
	}

	/**
	 * loadMdFilesFromJson loads metadata of Markdown files from a JSON file
	 * If the JSON file doesn't exist, returns an empty array
	 *
	 * @returns {MdConversionEntry[]} array of conversion metadata
	 */
	loadMdFilesFromJson(): MdConversionEntry[] {
		try {
			if (!fs.existsSync(this.dataFile)) {
				return [];
			}
			return JSON.parse(
				fs.readFileSync(this.dataFile, "utf8")
			) as MdConversionEntry[];
		} catch (error) {
			console.error(`Error loading data from ${this.dataFile}: ${error}`);
			return [];
		}
	}

	/**
	 * checkTargetFiles iterates over each target file and checks for:
	 * 1. A corresponding entry in the conversion metadata
	 * 2. A corresponding source file
	 * If no corresponding entry or source file is found, or if the source file is newer,
	 * it deletes the target file and updates the conversion metadata
	 *
	 * @param {MarkdownFile[]} targetFiles array of md files from the target directory
	 * @param {MarkdownFile[]} sourceFiles array of md files from the source directory
	 * @param {MdConversionEntry[]} mdConversionEntries current conversion metadata
	 */
	checkTargetFiles(
		targetFiles: MarkdownFile[],
		sourceFiles: MarkdownFile[],
		mdConversionEntries: MdConversionEntry[]
	): void {
		// Iterate over each target file
		targetFiles.forEach((targetFile) => {
			// Find the corresponding entry in mdConversionEntries
			//console.log(mdConversionEntries);
			//console.log("Search for:");
			//console.log(targetFile.absolutepath);
			const entryIndex = mdConversionEntries.findIndex(
				(entry) => targetFile.absolutepath === entry.targetPath
			);

			// If no corresponding entry is found, delete the target file
			if (entryIndex === -1) {
				this.deleteAndLog(
					targetFile,
					mdConversionEntries,
					"no corresponding entry was found in mdConversionEntries"
				);
			} else {
				// If a corresponding entry is found, find the corresponding source file
				const sourceFileIndex = sourceFiles.findIndex(
					(sourceFile) =>
						sourceFile.absolutepath ===
						mdConversionEntries[entryIndex].sourcePath
				);

				// If no corresponding source file is found or the source file is newer, delete the target file
				if (
					sourceFileIndex === -1 ||
					sourceFiles[sourceFileIndex].dateModified >
						targetFile.dateModified
				) {
					this.deleteAndLog(
						targetFile,
						mdConversionEntries,
						"no corresponding source file was found or the source file was newer",
						entryIndex
					);
				}
			}
		});
	}

	/**
	 * deleteAndLog deletes a target file, updates the conversion metadata, and logs the deletion
	 *
	 * @param {MarkdownFile} targetFile the target file to delete
	 * @param {MdConversionEntry[]} mdConversionEntries the current conversion metadata
	 * @param {string} reason the reason for the deletion
	 * @param {number} entryIndex the index of the corresponding entry in mdConversionEntries
	 */
	deleteAndLog(
		targetFile: MarkdownFile,
		mdConversionEntries: MdConversionEntry[],
		reason: string,
		entryIndex?: number
	): void {
		targetFile.deleteFile();

		if (entryIndex !== undefined) {
			// Delete the corresponding entry in mdConversionEntries
			mdConversionEntries.splice(entryIndex, 1);
		}

		console.log(`Deleted ${targetFile.absolutepath} as ${reason}.`);
	}

	/**
	 * checkSourceFiles iterates over each source file and checks for:
	 * 1. A corresponding entry in the conversion metadata
	 * 2. A corresponding target file
	 * If no corresponding entry or target file is found, or if the source file is newer,
	 * it converts the source file and updates the conversion metadata
	 *
	 * @param {MarkdownSourceFile[]} sourceFiles array of md files from the source directory
	 * @param {MarkdownFile[]} targetFiles array of md files from the target directory
	 * @param {MdConversionEntry[]} mdConversionEntries current conversion metadata
	 */
	checkSourceFiles(
		sourceFiles: MarkdownSourceFile[],
		targetFiles: MarkdownFile[],
		mdConversionEntries: MdConversionEntry[]
	): void {
		// Iterate over each source file
		sourceFiles.forEach((sourceFile) => {
			// Find the corresponding entry in mdConversionEntries
			const entryIndex = mdConversionEntries.findIndex(
				(entry) => entry.sourcePath === sourceFile.absolutepath
			);

			// If no corresponding entry is found, convert the source file
			if (entryIndex === -1) {
				this.convertAndLog(
					sourceFile,
					mdConversionEntries,
					"no corresponding entry was found in mdConversionEntries"
				);
			} else {
				// If a corresponding entry is found, find the corresponding target file
				const targetFileIndex = targetFiles.findIndex(
					(targetFile) =>
						targetFile.absolutepath ===
						mdConversionEntries[entryIndex].targetPath
				);

				// If no corresponding target file is found or the source file is newer, convert the source file
				if (
					targetFileIndex === -1 ||
					sourceFile.dateModified >
						targetFiles[targetFileIndex].dateModified
				) {
					this.convertAndLog(
						sourceFile,
						mdConversionEntries,
						"no corresponding target file was found or the source file was newer"
					);
				}
			}
		});
	}

	/**
	 * convertAndLog converts a source file, updates the conversion metadata, and logs the conversion
	 *
	 * @param {MarkdownSourceFile} sourceFile the source file to convert
	 * @param {MdConversionEntry[]} mdConversionEntries the current conversion metadata
	 * @param {string} targetPath the path of the target file
	 * @param {string} reason the reason for the conversion
	 */
	convertAndLog(
		sourceFile: MarkdownSourceFile,
		mdConversionEntries: MdConversionEntry[],
		reason: string
	): void {
		try {
			sourceFile.convertMarkdownFile(this.targetFolder);
		} catch (error) {
			console.error(`An error occurred while attempting to convert the file ${sourceFile}:\n
        Error Message: ${error.message}\n
        Error Name: ${error.name}\n
        Stack Trace: ${error.stack}`);
			throw new Error();
		}

		mdConversionEntries.push({
			sourcePath: sourceFile.absolutepath,
			targetPath: sourceFile.targetPath,
		});

		console.log(`Converted ${sourceFile.absolutepath} as ${reason}.`);
	}

	/**
	 * Recursively removes empty directories in the specified directory and its subdirectories
	 *
	 * @param {string} directoryPath path of the directory to check
	 */
	removeEmptyDirectories(directoryPath: string): void {
		const FIRST_LEVEL_SUBDIRS = ["docs", "blog", "i18n"];
		const MULTI_BLOG_ENDING = "__blog"; // endswith

		// Get all directories
		const directories = fs
			.readdirSync(directoryPath, { withFileTypes: true })
			.filter((dirent) => dirent.isDirectory())
			.map((dirent) => dirent.name);

		directories.forEach((dir) => {
			const fullDirPath = path.join(directoryPath, dir);

			// Recursively remove empty directories in subdirectories first
			this.removeEmptyDirectories(fullDirPath);

			// Then check if the current directory is empty and remove it if it is
			const files = fs.readdirSync(fullDirPath);
			if (files.length === 0 && directoryPath !== this.sourceFolder) {
				fs.rmdirSync(fullDirPath);
				console.log(`Deleted ${fullDirPath}`);
			}
		});
	}

	// Removes the Database
	resetDatabase(): void {
		try {
			console.log(`Deleting ${this.dataFile}`);
			fs.unlinkSync(this.dataFile);
			console.log(`${this.dataFile} deleted successfully`);
		} catch (error) {
			console.error(`Error deleting ${this.dataFile}: ${error}`);
		}
	}
}

function isMarkdownSourceFileArray(
	files: MarkdownFile[] | MarkdownSourceFile[]
): files is MarkdownSourceFile[] {
	return files.every((file) => file instanceof MarkdownSourceFile);
}