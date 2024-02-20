import { SourceFileInfo } from "./types";


//this clas will receive a list of file info, and will be used
//to convert links in obsidian to docusaurus

export default class FileProcessor {

	sourceFileInfoList: Partial<SourceFileInfo>[];

	constructor(sourceFileInfoList: Partial<SourceFileInfo>[]) {
		this.sourceFileInfoList = sourceFileInfoList;
	}

	getPathOfFile(filename : string) : string | undefined{

		const fileInfo = this.sourceFileInfoList.find(
			(fileInfo) => fileInfo.fileName === filename
		);

		if(fileInfo)
			return fileInfo.pathSourceRelative;
	}
}

