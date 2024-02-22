import * as readline from 'readline';
import * as stream from 'stream'
import * as fs from 'fs';
import { logger } from 'main';
import { Admonition, Asset, Size, SourceFileInfo } from "./types";
import { config } from 'config';
import FileProcessor from './util/fileProcessor';



export default async function processMarkdown(
	processedFileName: string, 
	sourceContent: string, 
	assetJson: Asset[], 
	fileInfo : Partial<SourceFileInfo>[], 
	allSourceAssetsInfo : Partial<SourceFileInfo>[]): Promise<string> {
    // Create a stream from the source content

    const sourceStream = new stream.Readable();
    sourceStream.push(sourceContent);
    sourceStream.push(null);

    // Create a readline interface from the stream
    const rl = readline.createInterface({
        input: sourceStream,
        output: process.stdout,
        terminal: false
    });

    // Initialize the transformed content as an empty string
    let transformedContent = '';
    let inAdmonition = false, inQuote = false;
    let admonition = { type: '', title: '', whitespaces: 0 };

	//create a file processor
	const fileProcessor = new FileProcessor(fileInfo, allSourceAssetsInfo);
	

    // Iterate over the lines
    for await (const line of rl) {

        let processedLine = await convertObsidianLinks(line, fileProcessor);
        processedLine = checkForAssets(processedLine, processedFileName, assetJson, allSourceAssetsInfo);
        processedLine = checkForLinks(processedLine);
        [processedLine, inAdmonition, inQuote, admonition] = convertAdmonition(processedLine, inAdmonition, inQuote, admonition);

        // Append the processed line to the transformed content
        transformedContent += processedLine + '\n';
    }

    // Return the transformed content
    return transformedContent;
}

/**
 * This function will take care of converting obsidian link in the format [[filename|title]] to markdown format \[title](path).
 * This will convert both links to other notes and links to other images
 * @param line 
 * @param fileProcessor 
 * @returns 
 */
async function convertObsidianLinks(line: string, fileProcessor : FileProcessor) {

	

    const pattern = /(?:!)?\[\[(.*?)\]\]/;
    const match = line.match(pattern);


	if (match !== null) {

		//need to split match[1] by '|' to get the filename and the title
		const split = match[1].split("|");

		
		
		//filename is the first part of the split
		let filenameWithExtension : string = split[0];


		let title : string | undefined = split.last();

		//we need to add .md to match[1] to get the file name (if it doesnt have it already)
		if (!split[0].endsWith(".md")) {
			filenameWithExtension += ".md";
		}

		
		//the code below handles the case the link is another note
		//call the file processor to get the path of the file
		let newPath : string | undefined = fileProcessor.getPathOfFile(filenameWithExtension);


		if (newPath !== undefined) {
			const newLine = line.replace(match[0], `[${title}](${newPath})`);

			console.log("Converted note link: " + line + " to " + newLine);

			return newLine;
		} else {
			//now we will handle the case the link is an image
	
			//call the file processor to get the path of the image

			
			newPath = fileProcessor.getPathOfImage(match[1]);

			console.log("Checking path for image: " + match[1]);

			if (newPath !== undefined) {

				const newLine = line.replace(match[0], `![](${newPath})`);
				console.log("Converted image link: " + line + " to " + newLine);
				return newLine;

			}else{
				console.log("Could not find path for image: " + match[1]);
				return line;
			}
		}



	}

	return line;
}

const parseAdmonitionData = (line: string): Admonition => {
    const match = line.match(/^>\s*\[!(?<type>.*)](?<title>.*)?/);
    if (!match) return { type: '', title: '', whitespaces: 0 };

    return {
        type: match.groups?.type || '',
        title: match.groups?.title?.trim() || '',
        whitespaces: line.indexOf("[") - line.indexOf(">"),
    };
};

// Function to convert Admonition and quote blocks
const convertAdmonition = (line: string, isInAdmonition: boolean, isInQuote: boolean, admonition: Admonition): [string, boolean, boolean, Admonition] => {
    // Parse data if the line is the start of a new Admonition or quote
    if (!isInAdmonition && !isInQuote) {
        admonition = parseAdmonitionData(line);
    }

    // Process the line based on whether it's part of an Admonition, a quote, or a normal line
    if (isInAdmonition) {
        if (line.trim() === '') {
            // If the line is empty, it's the end of the Admonition
            line = ":::\n"
            isInAdmonition = false
        } else {
            // If the line is not empty, it's part of the Admonition
            line = line.slice(admonition.whitespaces);
        }
    } else if (isInQuote) {
        if (line.trim() === '') {
            // If the line is empty, it's the end of the quote
            line = ">\n> — " + admonition.title + "\n";
            isInQuote = false;
        }
    } else if (admonition.type) {
        if (admonition.type === "quote") {
            // The line is the start of a new quote
            line = "";
            isInQuote = true;
        } else {
            // The line is the start of a new Admonition
            isInAdmonition = true;
            line = ":::" + admonition.type;
            if (admonition.title) {
                line += " " + admonition.title;
            }
            line += "\n";
        }
    }

    return [line, isInAdmonition, isInQuote, admonition];
};

function checkForLinks(line: string): string {
    const pattern = /\[([^\]]+)\]\(([^)]+)\)/;
    const match = line.match(pattern);

    if (match) {

        const url = match[2];

        // keep external links as is
        if (url.includes("http")) {
            return line;
        // only continue with internal links
        } else {
            const urlParts = url.split("/");

            if (urlParts.length <= 1) return line;

            let mainFolder = urlParts[0];

            const isBlog = isBlogFolder(mainFolder);

            if (isBlog) {
                mainFolder = removeBlogSuffix(mainFolder);
                urlParts[0] = mainFolder;
            }

            const processedUrlParts = processUrlParts(urlParts, isBlog);

            const newUrl = "/" + processedUrlParts.join("/");
            return line.replace(url, newUrl);
        }
    }
    return line
}

function processUrlParts(urlParts: string[], isBlog: boolean): string[] {
    urlParts = [...urlParts];  // create a copy to not modify original

    const [file, anchor] = urlParts[urlParts.length - 1].split("#");

    let parentFolder = urlParts[urlParts.length - 2];

    if (parentFolder.endsWith("+")) {
        parentFolder = parentFolder.replace("+", "");
        urlParts.pop();

        urlParts[urlParts.length - 1] = isBlog
            ? parentFolder.split("-").join("/")
            : removeNumberPrefix(parentFolder);
    } else if (file.endsWith(".md")) {
        urlParts[urlParts.length - 1] = file.replace(".md", "");
    }

    if (isBlog) {
        urlParts[urlParts.length - 1] = urlParts[urlParts.length - 1].split("-").join("/");
    }

    if (!isBlog) {
        urlParts = urlParts.map(part => removeNumberPrefix(part));
    }
    
    if (anchor) {
      urlParts[urlParts.length - 1] = urlParts[urlParts.length - 1] + "#" + anchor.split("%20").join("-").toLowerCase();
    }

    return urlParts;
}

function isBlogFolder(mainFolder: string): boolean {
    return mainFolder === "blog" || mainFolder.endsWith("__blog");
}

function removeBlogSuffix(mainFolder: string): string {
    return mainFolder.replace("__blog", "");
}

function removeNumberPrefix(str: string): string {
    // Removes all common numbering styles: 1), 1., 1 -, ...
    return str.replace(/^\d+[\.\-\)\s%20]*\s*/, "").trim();
}

function getOrCreateSize(sizes: Size[], size: string, processedFileName: string): Size {
    let existingSize = sizes.find(s => s.size === size);
    if (!existingSize) {
        existingSize = {
            size,
            inDocuments: [processedFileName],
            newName: []
        };
        sizes.push(existingSize);
    } else if (!existingSize.inDocuments.includes(processedFileName)) {
        existingSize.inDocuments.push(processedFileName);
    }
    return existingSize;
}

function addToAssetJson(
	assetJson : Asset[], 
	fileName: string, 
	fileNameWithExtension: string | undefined, 
	fileExtension: string,
	path: string | undefined,
	size: string,
	processedFileName: string) : Size {

		if(path === undefined){
			console.log("Could not find path for asset: " + fileName);
			throw new Error("Could not find path for asset: " + fileName);
		}

		let existingAsset = assetJson.find(item => item.fileName === fileName);
		let existingSize: Size;
		if (existingAsset) {
			existingSize = getOrCreateSize(existingAsset.sizes, size, processedFileName);
		} else {
			existingAsset = {
				fileName,
				//@ts-ignore
				originalFileName: fileNameWithExtension,
				fileExtension,
				dateModified: new Date().toISOString(),
				sourcePathRelative: path,
				sizes: []
			};
			//@ts-ignore
			existingSize = getOrCreateSize(existingAsset.sizes, size, processedFileName);
			//@ts-ignore
			assetJson.push(existingAsset);
		}

		console.log("Added asset: " + fileName + " with size: " + size + " and path: " + path);

		return existingSize;
}

function checkForAssets(line: string, processedFileName: string, assetJson: Asset[], allSourceAssetsInfo : Partial<SourceFileInfo>[]): string {
    const match = line.match(/!\[(?:\|(?<size>\d+(x\d+)?))?\]\((?<path>.*?)\)/);

	console.log("DEBUG " + line)

    if (match && match.groups) {
        // eslint-disable-next-line prefer-const
        let { size, path } = match.groups;
        const fileNameWithExtension = path.split('/').pop();
        // eslint-disable-next-line prefer-const
        //@ts-ignore
        let [fileName, fileExtension] = fileNameWithExtension.split('.');
        fileName = fileName.replace(/ /g, "_");
        fileName = fileName.replace(/%20/g, "_");

        if (!size?.trim()) {
            size = "standard"
        }

		const existingSize : Size = addToAssetJson(assetJson, fileName, fileNameWithExtension, fileExtension, path, size, processedFileName);

        

        if (["jpg", "png", "webp", "jpeg", "bmp", "gif", "svg", "excalidraw"].includes(fileExtension)) {
            line = processImage(line, fileName, fileExtension, size, existingSize);
        } else {
            line = processAsset(line, fileName, fileExtension);
        }
    }


	//the code above handled links of the case ![filename|size](path)
	//we also need to copy assets of the type ![[filename]]

	const pattern = /(?:!)?\[\[(.*?)\]\]/;
	const match2 = line.match(pattern);

	if (match2 !== null) {
		const filenameWithExtension : string = match2[1];

		let [fileName, fileExtension] = filenameWithExtension.split('.');
        fileName = fileName.replace(/ /g, "_");
        fileName = fileName.replace(/%20/g, "_");

		let size : string = "standard";

		let path = allSourceAssetsInfo.find(item => item.fileName === filenameWithExtension)?.pathSourceRelative;

		const existingSize : Size = addToAssetJson(assetJson, fileName, filenameWithExtension, fileExtension, path, size, processedFileName);

		if (["jpg", "png", "webp", "jpeg", "bmp", "gif", "svg", "excalidraw"].includes(fileExtension)) {
			line = processImage(line, fileName, fileExtension, size, existingSize);
		} else {
			line = processAsset(line, fileName, fileExtension);
		}
	}

    return line;
}


function processImage(line: string, fileName: string, fileExtension: string, size: string, sizeObject: Size): string {
    const sizeSuffix = size === "standard" ? "" : `_${size}`;

    const extensionFormatMap: { [index: string]: string } = {
        "gif": `/assets/${fileName}${sizeSuffix}.${fileExtension}`,
        "svg": `/assets/${fileName}${sizeSuffix}.${fileExtension}`,
        //"svg": `/assets/${fileName}${sizeSuffix}.light.svg#light`,
        "excalidraw": `/assets/${fileName}${sizeSuffix}.excalidraw.light.svg#light`
    };

    let newPath = `/assets/${fileName}${sizeSuffix}.${config.convertedImageType}`;

    if (extensionFormatMap[fileExtension]) {
        newPath = extensionFormatMap[fileExtension];
        line = `![${fileName}](${newPath})`;

        // Special handling for SVG and excalidraw files
        if (fileExtension === "excalidraw") {
            const darkPath = newPath.replace('.light.svg#light', '.dark.svg#dark');
            line += `\n![${fileName}](${darkPath})`;
        }
    } else {
        line = `![${fileName}](${newPath})`;
    }

    const newName = newPath.split("/").pop()?.split("#")[0];
    // Only add newName if it doesn't already exist in sizeObject.newName
    if (newName && !sizeObject.newName.includes(newName)) {
        sizeObject.newName.push(newName);
    }
    return line;
}

function processAsset(line: string, fileName: string, fileExtension: string) {
    line = `[Download ${fileName}.${fileExtension}](${config.docusaurusAssetSubfolderName}/${fileName}.${fileExtension})`;
    return line;
}


function searchFile(fileName: string, directory: string): string | null {
    try {
        const files = fs.readdirSync(directory);

        for (const file of files) {
            const fullPath = `${directory}/${file}`;

            if (fs.statSync(fullPath).isDirectory()) {
                // If it's a directory, recursively search inside the directory
                const result = searchFile(fileName, fullPath);
                if (result) {
                    return result;
                }
            } else if (file === fileName) {
                // If it's a file with the specified name, return the full path
                return fullPath;
            }
        }

        // File not found
        return null;
    } catch (error) {
        // Handle errors such as permission issues or non-existent directories
        console.error(`Error while searching for ${fileName}: ${error.message}`);
        return null;
    }
}
