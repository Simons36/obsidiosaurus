import { SourceFileInfo, Asset } from "../types";


//this clas will receive a list of file info, and will be used
//to convert links in obsidian to docusaurus
//will also receive the same but for images, keeping two separate lists

export default class FileProcessor {

	sourceFileInfoList: Partial<SourceFileInfo>[];

	assetInfoList: Partial<SourceFileInfo>[];

	constructor(sourceFileInfoList: Partial<SourceFileInfo>[], assetInfoList: Partial<SourceFileInfo>[]) {
		this.sourceFileInfoList = sourceFileInfoList;
		this.assetInfoList = assetInfoList;
	}

	getPathOfImage(filename : string) : string | undefined{
		
		const assetInfo = this.assetInfoList.find(
			(assetInfo) => assetInfo.fileName === filename
		);

		if(assetInfo)
			return assetInfo.pathSourceRelative;
	}

	getPathOfFile(filename : string) : string | undefined{

		const fileInfo = this.sourceFileInfoList.find(
			(fileInfo) => fileInfo.fileName === filename
		);

		if(fileInfo)
			return fileInfo.pathSourceRelative;
	}
}

