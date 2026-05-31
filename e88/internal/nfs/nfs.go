package nfs

const (
	ProgramNFS      = 100003
	ProgramMount    = 100005
	ProgramNLM      = 100021
	ProgramNSM      = 100024

	Version3 = 3
	Version4 = 4

	NFS3ProcedureNull     = 0
	NFS3ProcedureGetAttr  = 1
	NFS3ProcedureSetAttr  = 2
	NFS3ProcedureLookup   = 3
	NFS3ProcedureAccess   = 4
	NFS3ProcedureReadlink = 5
	NFS3ProcedureRead     = 6
	NFS3ProcedureWrite    = 7
	NFS3ProcedureCreate   = 8
	NFS3ProcedureMkdir    = 9
	NFS3ProcedureSymlink  = 10
	NFS3ProcedureMknod    = 11
	NFS3ProcedureRemove   = 12
	NFS3ProcedureRmdir    = 13
	NFS3ProcedureRename   = 14
	NFS3ProcedureLink     = 15
	NFS3ProcedureReaddir  = 16
	NFS3ProcedureReaddirPlus = 17
	NFS3ProcedureFsStat   = 18
	NFS3ProcedureFsInfo   = 19
	NFS3ProcedurePathConf = 20
	NFS3ProcedureCommit   = 21

	NFS4ProcedureNull    = 0
	NFS4ProcedureCompound = 1

	MountProcedureNull   = 0
	MountProcedureMNT    = 1
	MountProcedureUMNT   = 3
	MountProcedureUMNTAll = 4
	MountProcedureExport = 5

	NFS3_OK              = 0
	NFS3ERR_PERM         = 1
	NFS3ERR_NOENT        = 2
	NFS3ERR_IO           = 5
	NFS3ERR_NXIO         = 6
	NFS3ERR_ACCES        = 13
	NFS3ERR_EXIST        = 17
	NFS3ERR_XDEV         = 18
	NFS3ERR_NODEV        = 19
	NFS3ERR_NOTDIR       = 20
	NFS3ERR_ISDIR        = 21
	NFS3ERR_INVAL        = 22
	NFS3ERR_FBIG         = 27
	NFS3ERR_NOSPC        = 28
	NFS3ERR_ROFS         = 30
	NFS3ERR_MLINK        = 31
	NFS3ERR_NAMETOOLONG  = 63
	NFS3ERR_NOTEMPTY     = 66
	NFS3ERR_DQUOT        = 69
	NFS3ERR_STALE        = 70
	NFS3ERR_REMOTE       = 71
	NFS3ERR_BADHANDLE    = 10001
	NFS3ERR_NOT_SYNC     = 10002
	NFS3ERR_BAD_COOKIE   = 10003
	NFS3ERR_NOTSUPP      = 10004
	NFS3ERR_TOOSMALL     = 10005
	NFS3ERR_SERVERFAULT  = 10006
	NFS3ERR_BADTYPE      = 10007
	NFS3ERR_JUKEBOX      = 10008

	Access3Read    = 0x01
	Access3Lookup  = 0x02
	Access3Modify  = 0x04
	Access3Extend  = 0x08
	Access3Delete  = 0x10
	Access3Execute = 0x20

	StableUnstable = 0
	StableDataSync = 1
	StableFileSync = 2
)

var NFS3ProcedureNames = map[uint32]string{
	0:  "NULL",
	1:  "GETATTR",
	2:  "SETATTR",
	3:  "LOOKUP",
	4:  "ACCESS",
	5:  "READLINK",
	6:  "READ",
	7:  "WRITE",
	8:  "CREATE",
	9:  "MKDIR",
	10: "SYMLINK",
	11: "MKNOD",
	12: "REMOVE",
	13: "RMDIR",
	14: "RENAME",
	15: "LINK",
	16: "READDIR",
	17: "READDIRPLUS",
	18: "FSSTAT",
	19: "FSINFO",
	20: "PATHCONF",
	21: "COMMIT",
}

var MountProcedureNames = map[uint32]string{
	0: "NULL",
	1: "MNT",
	3: "UMNT",
	4: "UMNTALL",
	5: "EXPORT",
}

var NFSStatusNames = map[uint32]string{
	0:     "OK",
	1:     "PERM",
	2:     "NOENT",
	5:     "IO",
	6:     "NXIO",
	13:    "ACCES",
	17:    "EXIST",
	18:    "XDEV",
	19:    "NODEV",
	20:    "NOTDIR",
	21:    "ISDIR",
	22:    "INVAL",
	27:    "FBIG",
	28:    "NOSPC",
	30:    "ROFS",
	31:    "MLINK",
	63:    "NAMETOOLONG",
	66:    "NOTEMPTY",
	69:    "DQUOT",
	70:    "STALE",
	71:    "REMOTE",
	10001: "BADHANDLE",
	10002: "NOT_SYNC",
	10003: "BAD_COOKIE",
	10004: "NOTSUPP",
	10005: "TOOSMALL",
	10006: "SERVERFAULT",
	10007: "BADTYPE",
	10008: "JUKEBOX",
}

func ProcedureName(program, version, proc uint32) string {
	switch program {
	case ProgramNFS:
		if version == Version3 {
			if name, ok := NFS3ProcedureNames[proc]; ok {
				return name
			}
		} else if version == Version4 {
			if proc == NFS4ProcedureCompound {
				return "COMPOUND"
			}
			return "NULL"
		}
	case ProgramMount:
		if name, ok := MountProcedureNames[proc]; ok {
			return name
		}
	}
	return "UNKNOWN"
}

func StatusName(status uint32) string {
	if name, ok := NFSStatusNames[status]; ok {
		return name
	}
	return "UNKNOWN"
}
